import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUserControlledRedirectRule } from '../../src/rules/no-user-controlled-redirect';

const TS = 'controller.ts';
const error = { messageId: 'userControlledRedirect' } as const;

/** The trust config a NestJS OAuth controller would carry. */
const APP_URL_TRUST = {
  trustedOrigins: ['this.shared.appUrl', 'buildAuthErrorRedirect()'],
  sanitizers: ['sanitizeReturnTo'],
  trustedPaths: ['TWO_FACTOR_CHALLENGE_PATH'],
};

ruleTester.run('no-user-controlled-redirect', noUserControlledRedirectRule, {
  valid: [
    { code: `redirect('/login');`, filename: TS },
    {
      code: `NextResponse.redirect('https://example.com/login');`,
      filename: TS,
    },
    // Same-origin path with a runtime segment.
    { code: 'res.redirect(`/users/${id}`);', filename: TS },
    // Express two-argument form: the URL is the LAST argument, not the status.
    { code: `res.redirect(302, '/login');`, filename: TS },
    // Relative input on `new URL` inherits a trusted base's origin.
    {
      code: `NextResponse.redirect(new URL('/login', request.url));`,
      filename: TS,
      options: [{ trustedOrigins: ['request.url'] }],
    },
    // The OAuth controller shapes, once the trust vocabulary is configured.
    {
      code: [
        'class C {',
        '  a(res) { res.redirect(302, `${this.shared.appUrl}${TWO_FACTOR_CHALLENGE_PATH}`); }',
        '  b(res, flow) { res.redirect(302, `${this.shared.appUrl}${sanitizeReturnTo(flow.returnTo)}`); }',
        '  c(res, code) { res.redirect(302, buildAuthErrorRedirect(this.shared.appUrl, code)); }',
        '  d(res) { res.redirect(302, `${this.shared.appUrl}/dashboard?linked=1`); }',
        '}',
      ].join('\n'),
      filename: TS,
      options: [APP_URL_TRUST],
    },
    // A sanitizer's result on its own is a safe same-origin path.
    {
      code: 'res.redirect(sanitizeReturnTo(req.query.next));',
      filename: TS,
      options: [APP_URL_TRUST],
    },
    // TanStack Router: an options object names a route via `to`, not a location.
    {
      code: `throw redirect({ to: '/auth/login', search: { redirect: location.href } });`,
      filename: TS,
    },
    { code: `throw redirect({ to: LOGIN_PATH, search });`, filename: TS },
    // ...and a literal `href` is fine.
    {
      code: `throw redirect({ href: 'https://example.com/docs' });`,
      filename: TS,
    },
    // Not a redirect callee by default (`ctx.redirect` needs configuring).
    { code: 'ctx.redirect(url);', filename: TS },
    // A status code is not the URL in the single-argument-last shape.
    { code: `res.redirect('/done');`, filename: TS },
    // Location headers with a fixed origin.
    { code: "res.location('/login');", filename: TS },
    {
      code: "res.set('Location', `/users/${id}`).status(302).end();",
      filename: TS,
    },
    { code: "res.status(302).set('Location', '/home').end();", filename: TS },
    { code: "res.writeHead(302, { Location: '/home' });", filename: TS },
    { code: "res.set('Content-Type', contentType);", filename: TS },
    { code: "res.set({ 'Cache-Control': value });", filename: TS },
    { code: "headers.set('Location', target);", filename: TS },
    // A target whose host passed an anchored allowlist before the redirect.
    {
      code: "function go(req, res) { const target = String(req.query.next); let host = ''; try { host = new URL(target).hostname; } catch { return res.status(400).end(); } if (!/^(app|docs)\\.example\\.com$/.test(host)) return res.status(403).end(); res.redirect(target); }",
      filename: TS,
    },
    {
      code: "const HOSTS = ['app.example.com']; function go(req, res) { const target = req.query.next; const { hostname } = { hostname: '' }; const host = new URL(target).host; if (!HOSTS.includes(host)) { res.sendStatus(403); return; } const next = target; res.status(302).set('Location', String(next)).end(); }",
      filename: TS,
    },
    {
      code: "function go(req, res) { const target = req.query.next; const host = new URL(String(target)).hostname; if (host === 'app.example.com' || host === 'docs.example.com') { res.location(target).sendStatus(303); } }",
      filename: TS,
    },
    {
      code: "function go(req, res) { const target = req.query.next; const host = new URL(target).hostname; if (!/^([a-z]+\\.)?example\\.com$/.test(host)) throw new Error('host'); res.redirect(302, target); }",
      filename: TS,
    },
    // Same-site paths: one leading `/`, with `//` and `/\\` refused.
    {
      code: "function h(req, res) { const next = String(req.query.next); if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\\\')) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
    },
    {
      code: "function h(req, res) { const next = req.query.next; if (!/^\\/[^\\/\\\\\\s]/.test(next)) return res.redirect('/'); res.location(next).sendStatus(302); }",
      filename: TS,
    },
    {
      code: 'function h(req, res) { const next = req.query.next; if (/^\\/[a-z0-9][\\w\\/-]*$/.test(next)) { res.writeHead(302, { Location: next }); } }',
      filename: TS,
    },
    // A table of literal destinations.
    {
      code: "const DESTINATIONS = { home: '/', billing: '/settings/billing' }; function h(req, res) { res.redirect(DESTINATIONS[req.query.to] ?? '/'); }",
      filename: TS,
    },
    {
      code: "const ROUTES = new Map([['a', '/a'], ['b', '/b']]); function h(req, res) { const target = ROUTES.get(req.query.to); res.set('Location', target).sendStatus(302); }",
      filename: TS,
    },
    // The host checked inline, and an origin compared with a `const`.
    {
      code: "const HOSTS = ['app.example.com']; function h(req, res) { const url = String(req.query.url); if (!HOSTS.includes(new URL(url).hostname)) return res.sendStatus(400); res.redirect(url); }",
      filename: TS,
    },
  ],
  invalid: [
    // Plain user input.
    {
      code: 'redirect(searchParams.get("next"));',
      filename: TS,
      errors: [error],
    },
    { code: 'res.redirect(req.query.next);', filename: TS, errors: [error] },
    // Express two-argument form is recognised: the runtime URL in position 1 reports.
    {
      code: 'res.redirect(302, req.query.next);',
      filename: TS,
      errors: [error],
    },
    { code: 'reply.redirect(target);', filename: TS, errors: [error] },
    // The userinfo trick behind a trusted origin whose suffix is not sanitized:
    // `returnTo = "@evil.com"` makes the host evil.com.
    {
      code: 'class C { a(res, flow) { res.redirect(302, `${this.shared.appUrl}${flow.returnTo}`); } }',
      filename: TS,
      options: [APP_URL_TRUST],
      errors: [error],
    },
    // The same site with nothing configured: the origin itself is runtime.
    {
      code: 'class C { a(res) { res.redirect(302, `${this.shared.appUrl}${PATH}`); } }',
      filename: TS,
      errors: [error],
    },
    // A lone `/` then input: `//evil.com`.
    { code: 'res.redirect(`/${next}`);', filename: TS, errors: [error] },
    // TanStack Router `href` is a full location: a runtime one reports.
    {
      code: 'throw redirect({ href: search.next });',
      filename: TS,
      errors: [error],
    },
    // A configured `urlProperty` for an object-argument API.
    {
      code: 'navigate({ url: target });',
      filename: TS,
      options: [{ redirectCallees: [{ name: 'navigate', urlProperty: 'url' }] }],
      errors: [error],
    },
    // Configured callee with a numeric URL index.
    {
      code: 'ctx.redirect(301, url);',
      filename: TS,
      options: [
        {
          redirectCallees: [{ object: 'ctx', name: 'redirect', urlArgument: 1 }],
        },
      ],
      errors: [error],
    },
    // Location headers and chained receivers.
    { code: 'res.location(req.query.next);', filename: TS, errors: [error] },
    {
      code: 'res.location(String(next)).sendStatus(303);',
      filename: TS,
      errors: [error],
    },
    {
      code: "res.status(302).set('Location', String(target)).end();",
      filename: TS,
      errors: [error],
    },
    { code: "res.header('location', target);", filename: TS, errors: [error] },
    {
      code: "res.setHeader('Location', target);",
      filename: TS,
      errors: [error],
    },
    {
      code: 'response.set({ Location: target });',
      filename: TS,
      errors: [error],
    },
    {
      code: "res.writeHead(302, { 'Location': target });",
      filename: TS,
      errors: [error],
    },
    {
      code: "res.writeHead(302, 'Found', { location: target });",
      filename: TS,
      errors: [error],
    },
    {
      code: "reply.code(302).header('Location', target).send();",
      filename: TS,
      errors: [error],
    },
    {
      code: 'res.status(302).redirect(target);',
      filename: TS,
      errors: [error],
    },
    // A value read from storage or a header is still a runtime origin.
    {
      code: "async function go(res) { const row = await db.query('SELECT url FROM links'); res.location(String(row.url)).sendStatus(303); }",
      filename: TS,
      errors: [error],
    },
    // Near misses of the host allowlist.
    {
      code: 'function go(target, res) { const host = new URL(target).hostname; if (!/example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { const host = new URL(target).hostname; if (!/^app\\.example\\.com|docs\\.example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { const host = new URL(target).hostname; if (!/^[a-z]+\\.[a-z]+$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { const host = new URL(target).hostname; if (!/^.*\\.example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { const host = new URL(target).hostname; if (!/^app\\.example\\.com$/.test(host)) { log(host); } res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: "function go(input, res) { let target = input; const host = new URL(target).hostname; if (!/^app\\.example\\.com$/.test(host)) return; target = input + '/x'; res.redirect(target); }",
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, other, res) { const host = new URL(other).hostname; if (!/^app\\.example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { const host = new URL(target, base).hostname; if (!/^app\\.example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { let host = new URL(target).hostname; host = getHost(); if (!/^app\\.example\\.com$/.test(host)) return; res.redirect(target); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function go(target, res) { res.redirect(target); const host = new URL(target).hostname; if (!/^app\\.example\\.com$/.test(host)) return; }',
      filename: TS,
      errors: [error],
    },
    // Near misses of the same-site checks.
    {
      code: "function h(req, res) { const next = String(req.query.next); if (!next.startsWith('/') || next.startsWith('//')) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { const next = req.query.next; if (!/^\\/[\\w\\/-]*$/.test(next)) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { const next = req.query.next; if (!/^\\/[^\\/\\\\]/.test(next)) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { const next = req.query.next; if (!/^\\/[a-z]?/.test(next)) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
      errors: [error],
    },
    // A table that can change, or holds runtime values.
    {
      code: "const DESTINATIONS = { home: '/' }; function add(k, v) { DESTINATIONS[k] = v; } function h(req, res) { res.redirect(DESTINATIONS[req.query.to]); }",
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(req, res) { const DESTINATIONS = { back: req.query.back }; res.redirect(DESTINATIONS[req.query.to]); }',
      filename: TS,
      errors: [error],
    },
    // The inline host check must exit, and must check the URL that is used.
    {
      code: "const HOSTS = ['app.example.com']; function h(req, res) { const url = String(req.query.url); if (!HOSTS.includes(new URL(other).hostname)) return; res.redirect(url); }",
      filename: TS,
      errors: [error],
    },
  ],
});
