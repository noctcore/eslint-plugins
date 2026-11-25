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

const raw = String.raw;

/** A handler that reads `next` from the query, exits unless `guard` fails, then runs `sink`. */
const guarded = (guard: string, sink: string): string =>
  `function h(req, res, reply) { const next = String(req.query.next); if (${guard}) return; ${sink} }`;

/** `startsWith('/')` with `//` and `/\` refused, but no tab or line break. */
const SLASH_ONLY = raw`!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')`;

/** A URL whose host (not origin) was checked, then `sink`. */
const hostChecked = (sink: string): string =>
  `function h(req, res) { const target = String(req.query.next); const host = new URL(target).hostname; if (host !== 'app.example.com') return; ${sink} }`;

/** A URL object whose origin was checked and `//` paths refused, then `change`, then the redirect. */
const originChecked = (change: string): string =>
  `const ORIGIN = 'https://app.example.com'; function h(req, res) { const u = new URL(String(req.query.next), ORIGIN); const ok = u.origin === ORIGIN && !u.pathname.startsWith('//'); ${change} res.redirect(ok ? u.pathname + u.search : '/'); }`;

/** A URL object whose host was checked against a list, then `change`, then the redirect. */
const hostListChecked = (change: string): string =>
  `const HOSTS = ['app.example.com']; function h(req, res) { const u = new URL(String(req.query.to)); if (!HOSTS.includes(u.hostname)) return; ${change} res.redirect(u.href); }`;

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
    // Same-site paths: one leading `/`, with `//`, `/\\`, a tab and line breaks refused.
    {
      code: "function h(req, res) { const next = String(req.query.next); if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\\\') || next.includes('\\t') || next.includes('\\n') || next.includes('\\r')) return res.redirect('/'); res.redirect(next); }",
      filename: TS,
    },
    {
      code: "function h(req, res) { const next = String(req.query.next); if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\\\') || /[\\t\\n\\r]/.test(next)) return res.end(); res.set('Location', next).sendStatus(302); }",
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
    // Shape: a URL resolved against a literal origin, its origin compared and `//` paths refused through a boolean.
    {
      code: "const ORIGIN = 'https://app.example.com'; function h(req, res) { const u = new URL(String(req.query.next), ORIGIN); const ok = u.origin === ORIGIN && !u.pathname.startsWith('//'); res.status(302).location(ok ? u.pathname + u.search : '/').end(); }",
      filename: TS,
    },
    {
      code: "const ORIGIN = 'https://app.example.com'; function h(req, res) { const u = new URL(String(req.query.next), ORIGIN); const ok = u.origin === ORIGIN && !u.pathname.startsWith('//'); res.writeHead(302, { Location: ok ? u.pathname + u.search : '/' }); }",
      filename: TS,
    },
    // Shape: a local-path regex with a lookahead, in a `?:` at the sink, also on a decoded value.
    {
      code: "const LOCAL = /^\\/(?![\\/\\\\])[\\x21-\\x7e]*$/; function h(req, res) { const next = String(req.query.next); res.redirect(LOCAL.test(next) ? next : '/'); }",
      filename: TS,
    },
    {
      code: "const LOCAL = /^\\/(?!\\/)[\\w\\-./?=&%]*$/; function h(req, res) { const next = decodeURIComponent(String(req.query.next)); res.redirect(LOCAL.test(next) ? next : '/'); }",
      filename: TS,
    },
    // Shape: the regex result and the target through two `const` bindings.
    {
      code: "const LOCAL = /^\\/(?!\\/|\\\\)[!-~]*$/; function h(req, res) { const next = String(req.query.next); const ok = LOCAL.test(next); const target = ok ? next : '/'; res.writeHead(302, { Location: target }); }",
      filename: TS,
    },
    // Shape: a literal origin with no path, then a value that starts with `/`.
    {
      code: "function h(req, res) { const next = String(req.query.next); const local = next.startsWith('/'); res.redirect('https://app.example.com' + (local ? next : '/')); }",
      filename: TS,
    },
    // Shape: exact membership in a module-level literal Set with an early return, then a query suffix.
    {
      code: "const TARGETS = new Set(['https://docs.example.com', '/home']); function h(req, res) { const to = String(req.query.to); if (!TARGETS.has(to)) { res.status(400).end(); return; } res.redirect(`${to}?from=login`); }",
      filename: TS,
    },
    // Shape: a URL parsed in try/catch with a literal fallback, protocol and host checked against a const list.
    {
      code: "const HOSTS = ['app.example.com', 'docs.example.com']; function h(req, res) { let u; try { u = new URL(String(req.query.to), 'https://app.example.com'); } catch { u = new URL('https://app.example.com/'); } const ok = u.protocol === 'https:' && HOSTS.includes(u.hostname); res.redirect(ok ? u.href : '/'); }",
      filename: TS,
    },
    // A host check is enough for a `Location` header a response object writes:
    // browsers refuse to follow one to a scheme other than http(s).
    {
      code: "function h(req, res) { const target = String(req.query.next); const host = new URL(target).hostname; if (host !== 'app.example.com') return; res.set('Location', target).sendStatus(302); }",
      filename: TS,
    },
    // An `origin` check pins the scheme too, so it counts at every sink.
    {
      code: "function h(req) { const target = String(req.query.next); const origin = new URL(target).origin; if (origin !== 'https://app.example.com') return; redirect(target); }",
      filename: TS,
    },
    {
      code: "function h(req) { const u = new URL(String(req.query.next)); if (u.origin !== 'https://app.example.com') return; return new Response(null, { status: 302, headers: { Location: u.href } }); }",
      filename: TS,
    },
    // A public suffix with one more literal label pinned before it.
    {
      code: 'function h(req, res) { const next = String(req.query.next); if (!/^[a-z0-9-]+\\.myapp\\.vercel\\.app$/.test(new URL(next).hostname)) return; res.redirect(next); }',
      filename: TS,
    },
    {
      code: 'function h(req, res) { const next = String(req.query.next); if (!/^[a-z0-9-]+\\.example\\.co\\.uk$/.test(new URL(next).hostname)) return; res.redirect(next); }',
      filename: TS,
    },
    // Any subdomain of example.com, and an origin with an optional subdomain.
    {
      code: 'function h(req, res) { const next = String(req.query.next); if (!/^(?:[a-z0-9-]+\\.)*example\\.com$/.test(new URL(next).hostname)) return res.status(403).end(); res.redirect(next); }',
      filename: TS,
    },
    {
      code: 'function h(req) { const next = String(req.query.next); if (!/^https:\\/\\/([a-z0-9-]+\\.)?example\\.com$/.test(new URL(next).origin)) return; redirect(next); }',
      filename: TS,
    },
    // Fixed values in the other header forms.
    { code: "res.writeHead(302, ['Location', '/home', 'Cache-Control', cache]);", filename: TS },
    { code: "res.writeHead(302, [['Location', '/home'], ['Content-Type', type]]);", filename: TS },
    { code: "res.setHeader('Location', ['/home']);", filename: TS },
    { code: "res.append('Link', link);", filename: TS },
    { code: "const L = 'Content-Type'; res.set(L, type);", filename: TS },
    {
      code: "function h(res) { const headers = { Location: '/home', 'Content-Type': type }; res.writeHead(302, headers); }",
      filename: TS,
    },
    { code: "Response.redirect('https://app.example.com/', 302);", filename: TS },
    { code: "new Response(null, { status: 302, headers: { Location: '/home' } });", filename: TS },
    // Literal text the parser keeps as a path (a tab after `/a` is dropped, leaving `/a`).
    { code: "res.redirect('/a\t' + req.query.next);", filename: TS },
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
    // Near misses: a non-literal origin, a missing `//` refusal, an unchanged-URL break.
    {
      code: "function h(req, res, origin: string) { const u = new URL(String(req.query.next), origin); const ok = u.origin === origin && !u.pathname.startsWith('//'); res.redirect(ok ? u.pathname + u.search : '/'); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const ORIGIN = 'https://app.example.com'; function h(req, res) { const u = new URL(String(req.query.next), ORIGIN); const ok = u.origin === ORIGIN; res.redirect(ok ? u.pathname + u.search : '/'); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const ORIGIN = 'https://app.example.com'; function h(req, res) { const u = new URL(String(req.query.next), ORIGIN); const ok = u.origin === ORIGIN && !u.pathname.startsWith('//'); u.pathname = String(req.query.p); res.redirect(ok ? u.pathname + u.search : '/'); }",
      filename: TS,
      errors: [error],
    },
    // An unanchored regex, a lookahead that lets `\\` through, a regex tested on another value.
    {
      code: "const LOCAL = /\\/(?![\\/\\\\])[\\x21-\\x7e]*/; function h(req, res) { const next = String(req.query.next); res.redirect(LOCAL.test(next) ? next : '/'); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const LOCAL = /^\\/(?!\\/)[\\x21-\\x7e]*$/; function h(req, res) { const next = String(req.query.next); res.redirect(LOCAL.test(next) ? next : '/'); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const LOCAL = /^\\/(?![\\/\\\\])[\\x21-\\x7e]*$/; function h(req, res) { const next = String(req.query.next); const ok = LOCAL.test(String(req.query.other)); res.redirect(ok ? next : '/'); }",
      filename: TS,
      errors: [error],
    },
    // The `?:` branches swapped, and a target in the wrong branch.
    {
      code: "const LOCAL = /^\\/(?![\\/\\\\])[\\x21-\\x7e]*$/; function h(req, res) { const next = String(req.query.next); res.redirect(LOCAL.test(next) ? '/' : next); }",
      filename: TS,
      errors: [error],
    },
    // An origin literal with a path or userinfo slot, and a value not checked for `/`.
    {
      code: "function h(req, res) { const next = String(req.query.next); res.redirect('https://app.example.com' + next); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { const next = String(req.query.next); const local = next.startsWith('/'); res.redirect('https://app.example.com' + (local ? next : '.evil.com')); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res, base: string) { const next = String(req.query.next); const local = next.startsWith('/'); res.redirect(base + (local ? next : '/')); }",
      filename: TS,
      errors: [error],
    },
    // A Set check without the early return, a mutated Set, a suffix that is not a query.
    {
      code: "const TARGETS = new Set(['/home']); function h(req, res) { const to = String(req.query.to); if (!TARGETS.has(to)) { res.status(400); } res.redirect(to); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const TARGETS = new Set(['/home']); function h(req, res) { TARGETS.add(String(req.query.x)); const to = String(req.query.to); if (!TARGETS.has(to)) return; res.redirect(to); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const TARGETS = new Set(['https://docs.example.com']); function h(req, res) { const to = String(req.query.to); if (!TARGETS.has(to)) return; res.redirect(`${to}${String(req.query.rest)}`); }",
      filename: TS,
      errors: [error],
    },
    // A host list that is not literal, and a URL written after the check.
    {
      code: "function h(req, res, hosts: string[]) { let u; try { u = new URL(String(req.query.to), 'https://app.example.com'); } catch { u = new URL('https://app.example.com/'); } const ok = u.protocol === 'https:' && hosts.includes(u.hostname); res.redirect(ok ? u.href : '/'); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const HOSTS = ['app.example.com']; function h(req, res) { let u = new URL(String(req.query.to), 'https://app.example.com'); const ok = HOSTS.includes(u.hostname); u = new URL(String(req.query.other)); res.redirect(ok ? u.href : '/'); }",
      filename: TS,
      errors: [error],
    },
    // `startsWith('/')` without refusing a tab or line break: browsers drop
    // them, so `/<tab>/evil.com` goes to evil.com through a raw header.
    {
      code: guarded(SLASH_ONLY, "res.set('Location', next).sendStatus(302);"),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(SLASH_ONLY, "res.setHeader('Location', next);"),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(SLASH_ONLY, 'res.writeHead(302, { Location: next });'),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(SLASH_ONLY, "reply.header('Location', next).code(302).send();"),
      filename: TS,
      errors: [error],
    },
    { code: guarded(SLASH_ONLY, 'res.redirect(next);'), filename: TS, errors: [error] },
    // Each of `\t`, `\n` and `\r` must be refused.
    {
      code: guarded(
        raw`${SLASH_ONLY} || next.includes('\n') || next.includes('\r')`,
        "res.set('Location', next);",
      ),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(
        raw`${SLASH_ONLY} || next.includes('\t') || next.includes('\r')`,
        "res.setHeader('Location', next);",
      ),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(
        raw`${SLASH_ONLY} || next.includes('\t') || next.includes('\n')`,
        'res.writeHead(302, { Location: next });',
      ),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(raw`${SLASH_ONLY} || /[\t\n]/.test(next)`, "reply.header('Location', next);"),
      filename: TS,
      errors: [error],
    },
    {
      code: guarded(raw`!/^\/[^\/\\]/.test(next)`, "res.set('Location', next);"),
      filename: TS,
      errors: [error],
    },
    // The bare value searched while `String(next)` was checked: an array `next` passes `includes`.
    {
      code: raw`function h(req, res) { const next = req.query.next; if (!String(next).startsWith('/') || String(next).startsWith('//') || String(next).startsWith('/\\') || next.includes('\t') || next.includes('\n') || next.includes('\r')) return; res.set('Location', next); }`,
      filename: TS,
      errors: [error],
    },
    // The URL changed after its origin or host was checked.
    {
      code: originChecked('Object.assign(u, { pathname: String(req.query.p) });'),
      filename: TS,
      errors: [error],
    },
    { code: originChecked('rewrite(u);'), filename: TS, errors: [error] },
    {
      code: originChecked("Reflect.set(u, 'pathname', String(req.query.p));"),
      filename: TS,
      errors: [error],
    },
    {
      code: originChecked('const v = u; v.pathname = String(req.query.p);'),
      filename: TS,
      errors: [error],
    },
    {
      code: hostListChecked("Object.assign(u, { hostname: 'evil.com' });"),
      filename: TS,
      errors: [error],
    },
    { code: hostListChecked('rewrite(u);'), filename: TS, errors: [error] },
    { code: hostListChecked('u.href = String(req.query.other);'), filename: TS, errors: [error] },
    // A guard in another function, or in a callback, proves nothing here.
    {
      code: raw`function check(next) { if (!/^\/[\w-]*$/.test(next)) throw new Error('next'); } function h(req, res) { const next = String(req.query.next); check(next); res.set('Location', next); }`,
      filename: TS,
      errors: [error],
    },
    {
      code: raw`function h(req, res) { const next = String(req.query.next); [next].forEach((n) => { if (!/^\/[\w-]*$/.test(n)) throw new Error('next'); }); res.set('Location', next); }`,
      filename: TS,
      errors: [error],
    },
    // More header writes: `append`, a header name held in a binding or written
    // in another case, a computed method, Node's array forms, `setHeaders`.
    { code: "res.append('Location', req.query.next);", filename: TS, errors: [error] },
    { code: "res.status(302).append('location', target).end();", filename: TS, errors: [error] },
    { code: "res.appendHeader('Location', target);", filename: TS, errors: [error] },
    { code: "const L = 'Location'; res.set(L, target);", filename: TS, errors: [error] },
    { code: "const L = 'location'; res.setHeader(L, target);", filename: TS, errors: [error] },
    { code: "let L = 'LOCATION'; reply.header(L, target);", filename: TS, errors: [error] },
    {
      code: "const L = 'Location'; const NAME = L; res.set(NAME, target);",
      filename: TS,
      errors: [error],
    },
    { code: 'res.set(`Location`, target);', filename: TS, errors: [error] },
    { code: "res['setHeader']('Location', target);", filename: TS, errors: [error] },
    { code: "res['redirect'](target);", filename: TS, errors: [error] },
    {
      code: "const L = 'Location'; res.writeHead(302, { [L]: target });",
      filename: TS,
      errors: [error],
    },
    { code: "res.set({ ['location']: target });", filename: TS, errors: [error] },
    { code: "res.writeHead(302, ['Location', target]);", filename: TS, errors: [error] },
    {
      code: "res.writeHead(302, ['Content-Type', type, 'location', target]);",
      filename: TS,
      errors: [error],
    },
    { code: "res.writeHead(302, [['Location', target]]);", filename: TS, errors: [error] },
    {
      code: "res.writeHead(302, 'Found', [['Content-Type', type], ['Location', target]]);",
      filename: TS,
      errors: [error],
    },
    { code: "res.setHeader('Location', [target]);", filename: TS, errors: [error] },
    { code: "res.setHeaders(new Map([['Location', target]]));", filename: TS, errors: [error] },
    { code: 'res.setHeaders(new Headers({ Location: target }));', filename: TS, errors: [error] },
    // A headers holder built before the write.
    {
      code: 'function h(res) { const headers = { Location: target }; res.writeHead(302, headers); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(res) { const headers = {}; headers.Location = target; res.writeHead(302, headers); }',
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const headers = {}; headers['location'] = target; res.writeHead(302, headers); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const headers = []; headers.push('Location', target); res.writeHead(302, headers); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const headers = new Headers(); headers.set('Location', target); res.setHeaders(headers); }",
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(res) { const headers = {}; Object.assign(headers, { Location: target }); res.writeHead(302, headers); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'res.writeHead(302, Object.assign({}, base, { Location: target }));',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(res) { const extra = { Location: target }; res.writeHead(302, { ...extra }); }',
      filename: TS,
      errors: [error],
    },
    // A holder that refers to itself still ends.
    {
      code: 'function h(res) { const headers = {}; Object.assign(headers, headers, { Location: target }); res.writeHead(302, headers); }',
      filename: TS,
      errors: [error],
    },
    // A host regex must end in a literal domain of at least two labels, right
    // after `^`, a literal dot or a group ending in one: `evilexample.com` and
    // any `.com` host pass these.
    {
      code: 'function h(req, res) { const next = String(req.query.next); if (!/^[a-z0-9.-]*example\\.com$/.test(new URL(next).hostname)) return res.status(403).end(); res.redirect(next); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(req, res) { const next = String(req.query.next); const host = new URL(next).hostname; if (!/^[\\w.-]*example\\.com$/.test(host)) return; res.redirect(next); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(req, res) { const next = String(req.query.next); if (!/^[a-z0-9-]+\\.com$/.test(new URL(next).hostname)) return; res.redirect(next); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(req) { const next = String(req.query.next); if (!/^https:\\/\\/[a-z0-9.-]*example\\.com$/.test(new URL(next).origin)) return; redirect(next); }',
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { const next = String(req.query.next); const host = new URL(next).hostname; if (!/^[a-z]+\\.?example\\.com$/.test(host)) return; res.set('Location', next).sendStatus(302); }",
      filename: TS,
      errors: [error],
    },
    // Fetch API redirects.
    {
      code: 'const init = { status: 302, headers: { Location: target } }; new Response(null, init);',
      filename: TS,
      errors: [error],
    },
    { code: 'Response.redirect(req.query.next);', filename: TS, errors: [error] },
    {
      code: 'new Response(null, { status: 302, headers: { location: target } });',
      filename: TS,
      errors: [error],
    },
    {
      code: "new NextResponse(null, { status: 307, headers: [['Location', target]] });",
      filename: TS,
      errors: [error],
    },
    {
      code: 'new Response(null, { status: 302, headers: new Headers({ Location: target }) });',
      filename: TS,
      errors: [error],
    },
    // A host regex over a public suffix: anyone can register `evil.vercel.app`.
    ...[
      '/^[a-z0-9-]+\\.vercel\\.app$/',
      '/^[a-z0-9-]+\\.github\\.io$/',
      '/^[a-z0-9-]+\\.netlify\\.app$/',
      '/^[a-z0-9-]+\\.pages\\.dev$/',
      '/^[a-z0-9-]+\\.co\\.uk$/',
      '/^(?:[a-z0-9-]+\\.)*vercel\\.app$/',
      '/^myapp-[a-z0-9-]+\\.vercel\\.app$/',
    ].map((regex) => ({
      code: `function h(req, res) { const next = String(req.query.next);
  if (!${regex}.test(new URL(next).hostname)) return;
  res.redirect(next); }`,
      filename: TS,
      errors: [error],
    })),
    {
      code: 'function h(req) { const next = String(req.query.next); if (!/^https:\\/\\/[a-z0-9-]+\\.vercel\\.app$/.test(new URL(next).origin)) return; redirect(next); }',
      filename: TS,
      errors: [error],
    },
    // A host check (not an origin check) does not pin the scheme:
    // `javascript://app.example.com/%0aalert(1)` has that host, and a sink
    // that can hand the URL to a client-side router may run it.
    { code: hostChecked('redirect(target);'), filename: TS, errors: [error] },
    { code: hostChecked('return NextResponse.redirect(target);'), filename: TS, errors: [error] },
    { code: hostChecked('return Response.redirect(target, 302);'), filename: TS, errors: [error] },
    {
      code: hostChecked(
        'return new Response(null, { status: 302, headers: { Location: target } });',
      ),
      filename: TS,
      errors: [error],
    },
    {
      code: "const HOSTS = ['app.example.com']; function h(req) { const u = new URL(String(req.query.next)); if (!HOSTS.includes(u.hostname)) return; redirect(u.href); }",
      filename: TS,
      errors: [error],
    },
    // Literal text the URL parser shrinks to a lone `/` (or to nothing), or
    // an authority opened by extra slashes.
    { code: "res.redirect('/\t' + req.query.next);", filename: TS, errors: [error] },
    { code: 'res.redirect(`/\\n${req.query.next}`);', filename: TS, errors: [error] },
    { code: "res.redirect('\t/' + req.query.next);", filename: TS, errors: [error] },
    { code: "res.redirect(' /' + req.query.next);", filename: TS, errors: [error] },
    { code: "res.redirect(' ' + req.query.next);", filename: TS, errors: [error] },
    { code: "res.redirect('https:///' + req.query.next);", filename: TS, errors: [error] },
    { code: "res.redirect('///' + req.query.next);", filename: TS, errors: [error] },
    { code: raw`res.redirect('/\t\\' + req.query.next);`, filename: TS, errors: [error] },
  ],
});

// Relative prefixes that can still grow into a scheme.
ruleTester.run('no-user-controlled-redirect: scheme-shaped prefixes', noUserControlledRedirectRule, {
  valid: [
    // A relative prefix that does pin the origin.
    { code: 'res.redirect(`home/${x}`);', filename: TS },
    { code: 'res.redirect(`page.html?${x}`);', filename: TS },
    { code: 'res.redirect(`/home${x}`);', filename: TS },
  ],
  invalid: [
    // A relative prefix that can still grow into a scheme.
    { code: 'res.redirect(`h${x}`);', filename: TS, errors: [error] },
    { code: 'res.redirect(`java${x}`);', filename: TS, errors: [error] },
    { code: "res.redirect('h' + x);", filename: TS, errors: [error] },
    {
      code: 'NextResponse.redirect(new URL(`h${x}`, request.url));',
      filename: TS,
      options: [{ trustedOrigins: ['request.url'] }],
      errors: [error],
    },
  ],
});

// SvelteKit `redirect(status, location)` reads the location, not the status.
ruleTester.run('no-user-controlled-redirect: status-first redirect', noUserControlledRedirectRule, {
  valid: [
    // Status first, then a fixed path.
    { code: "redirect(302, '/home');", filename: TS },
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load() { redirect(303, '/login'); }",
      filename: TS,
    },
    {
      code: "import * as kit from '@sveltejs/kit'; export function load() { kit.redirect(303, '/login'); }",
      filename: TS,
    },
  ],
  invalid: [
    // SvelteKit `redirect(status, location)`.
    { code: 'redirect(302, next);', filename: TS, errors: [{ ...error, data: { url: 'next' } }] },
    { code: 'throw redirect(307, target);', filename: TS, errors: [{ ...error, data: { url: 'target' } }] },
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load({ url }) { redirect(status, url.searchParams.get('next')); }",
      filename: TS,
      errors: [{ ...error, data: { url: "url.searchParams.get('next')" } }],
    },
    {
      code: "import { redirect as go } from '@sveltejs/kit'; export function load({ url }) { go(303, url.searchParams.get('next')); }",
      filename: TS,
      errors: [{ ...error, data: { url: "url.searchParams.get('next')" } }],
    },
    // A namespace import of SvelteKit.
    {
      code: "import * as kit from '@sveltejs/kit'; export function load() { kit.redirect(303, target); }",
      filename: TS,
      errors: [{ ...error, data: { url: 'target' } }],
    },
    {
      code: "import * as kit from '@sveltejs/kit'; export function load() { kit.redirect(status, target); }",
      filename: TS,
      errors: [{ ...error, data: { url: 'target' } }],
    },
    // The one-argument form is still read at argument 0.
    { code: 'redirect(target);', filename: TS, errors: [error] },
  ],
});

// Conditional holders, Fetch `Response` header writes and rarer holder forms.
ruleTester.run('no-user-controlled-redirect: headers holders', noUserControlledRedirectRule, {
  valid: [
    // A fixed Location in either branch of a conditional holder.
    { code: "res.writeHead(302, c ? { Location: '/home' } : {});", filename: TS },
    { code: "const hd = c && { Location: '/home' }; res.writeHead(302, hd);", filename: TS },
    // A Fetch response with a fixed Location, or a header that is not Location.
    {
      code: "function GET() { const r = new Response(null, { status: 302 }); r.headers.set('Location', '/home'); return r; }",
      filename: TS,
    },
    {
      code: "function GET() { const r = NextResponse.next(); r.headers.set('Content-Type', type); return r; }",
      filename: TS,
    },
    {
      code: "function GET() { const { headers } = new Response(null, { status: 302 }); headers.set('Content-Type', type); }",
      filename: TS,
    },
    // A Headers object that never reaches a response.
    { code: "const h = new Headers(); h.set('Location', target);", filename: TS },
    // Rarer holder forms with a fixed value.
    { code: "const hd = {}; Reflect.set(hd, 'Location', '/home'); res.writeHead(302, hd);", filename: TS },
    { code: "res.writeHead(302, Object.fromEntries([['Location', '/home']]));", filename: TS },
    { code: "res.writeHead(302, { get Location() { return '/home'; } });", filename: TS },
    { code: "res.writeHead(302, { Location: '/home' }, undefined);", filename: TS },
    { code: "Response.json({}, { status: 302, headers: { Location: '/home' } });", filename: TS },
    { code: "res.setHeader('X-' + 'Loc', target);", filename: TS },
    // A setter is not a value the header is sent with.
    { code: "res.writeHead(302, { set Location(v) { log(v); }, Location: '/home' });", filename: TS },
  ],
  invalid: [
    // Conditional or logical header holders.
    {
      code: 'function h(req, res) { const next = req.query.next; res.writeHead(302, req.query.a ? { Location: next } : {}); }',
      filename: TS,
      errors: [error],
    },
    {
      code: 'function h(req, res) { const next = req.query.next; const hd = req.query.a && { Location: next }; res.writeHead(302, hd); }',
      filename: TS,
      errors: [error],
    },
    { code: 'res.set(c || { Location: target });', filename: TS, errors: [error] },
    { code: 'res.writeHead(302, hd ?? { Location: target });', filename: TS, errors: [error] },
    // `headers.set('Location', x)` on a Fetch response.
    {
      code: "function GET(req) { const next = new URL(req.url).searchParams.get('next'); const r = new Response(null, { status: 302 }); r.headers.set('Location', next); return r; }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function middleware(req) { const r = NextResponse.next(); r.headers.set('Location', next); return r; }",
      filename: TS,
      errors: [error],
    },
    {
      code: "const response = NextResponse.next(); response.headers.set('location', target);",
      filename: TS,
      errors: [error],
    },
    {
      code: "const r = Response.json({}); r.headers.append('Location', target);",
      filename: TS,
      errors: [error],
    },
    // The headers of a Fetch response, moved off it first.
    {
      code: "function GET() { const r = new Response(null, { status: 302 }); const h = r.headers; h.set('Location', target); return r; }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function GET() { const r = new Response(null, { status: 302 }); const { headers } = r; headers.set('Location', target); return r; }",
      filename: TS,
      errors: [error],
    },
    // Alias writes.
    {
      code: 'function h(res) { const hd = {}; const a = hd; a.Location = target; res.writeHead(302, hd); }',
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const hd = new Map(); const a = hd; a.set('Location', target); res.setHeaders(hd); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h() { const hd = new Headers(); const a = hd; a.set('Location', target); return new Response(null, { status: 302, headers: hd }); }",
      filename: TS,
      errors: [error],
    },
    // `Reflect.set`, `Object.defineProperty`, index writes, `Object.fromEntries`, a getter.
    {
      code: "function h(res) { const hd = {}; Reflect.set(hd, 'Location', target); res.writeHead(302, hd); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const hd = {}; Object.defineProperty(hd, 'Location', { value: target }); res.writeHead(302, hd); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const hd = {}; Object.defineProperty(hd, 'location', { get: () => target }); res.writeHead(302, hd); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(res) { const hd = []; hd[0] = ['Location', target]; res.writeHead(302, hd); }",
      filename: TS,
      errors: [error],
    },
    { code: "res.writeHead(302, Object.fromEntries([['Location', target]]));", filename: TS, errors: [error] },
    { code: 'res.writeHead(302, { get Location() { return target; } });', filename: TS, errors: [error] },
    // A quoted or computed `headers` key, `Response.json` and `NextResponse.json`.
    {
      code: "new Response(null, { status: 302, 'headers': { Location: target } });",
      filename: TS,
      errors: [error],
    },
    {
      code: "new Response(null, { status: 302, ['headers']: { Location: target } });",
      filename: TS,
      errors: [error],
    },
    {
      code: 'Response.json({}, { status: 302, headers: { Location: target } });',
      filename: TS,
      errors: [error],
    },
    {
      code: 'NextResponse.json({}, { status: 302, headers: { Location: target } });',
      filename: TS,
      errors: [error],
    },
    // Headers before a trailing argument, a header name built from pieces.
    { code: 'res.writeHead(302, { Location: target }, undefined);', filename: TS, errors: [error] },
    { code: "res.setHeader('Loc' + 'ation', target);", filename: TS, errors: [error] },
    { code: "res.setHeader(`Loc${'ation'}`, target);", filename: TS, errors: [error] },
  ],
});

/** `n` alias swaps between two bindings, the shape that made the walk exponential. */
const cyclic = (first: string, n: number, sink: string): string =>
  `function h(req, res) { let p = ${first}; let q = p; ${'q = p; p = q; '.repeat(n)}${sink} }`;

// SvelteKit targets at argument 0, header names that can still be Location,
// relative prefixes no origin moving scheme starts with, and cyclic aliases.
ruleTester.run('no-user-controlled-redirect: kit targets, header names, prefixes', noUserControlledRedirectRule, {
  valid: [
    // A relative prefix no scheme that leaves the origin starts with.
    { code: 'res.redirect(`page${x}`);', filename: TS },
    { code: "res.redirect('users' + req.query.id);", filename: TS },
    { code: 'res.redirect(`api${req.query.p}`);', filename: TS },
    { code: 'res.redirect(`Profile.${req.query.tab}`);', filename: TS },
    {
      code: 'NextResponse.redirect(new URL(`settings${x}`, request.url));',
      filename: TS,
      options: [{ trustedOrigins: ['request.url'] }],
    },
    // A header name that cannot become Location, fixed or with a runtime piece.
    { code: "res.set('X-' + n, req.query.u);", filename: TS },
    { code: 'res.set(`Content-${n}`, req.query.u);', filename: TS },
    // A kit call with a fixed target in either position.
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load() { throw redirect('/login'); }",
      filename: TS,
    },
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load() { throw redirect('/login', 302); }",
      filename: TS,
    },
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load({ url }) { throw redirect(status, '/login'); }",
      filename: TS,
    },
    // A cyclic alias of a fixed name or holder stays quiet.
    { code: cyclic("'X-Trace'", 40, 'res.set(p, req.query.u);'), filename: TS },
    { code: cyclic('{}', 40, "p.Location = '/home'; res.set(p);"), filename: TS },
  ],
  invalid: [
    // A kit call with one argument or a number literal second names the target first.
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load({ url }) { const next = url.searchParams.get('next'); throw redirect(next); }",
      filename: TS,
      errors: [{ ...error, data: { url: 'next' } }],
    },
    {
      code: "import { redirect } from '@sveltejs/kit'; export function load({ url }) { throw redirect(url.searchParams.get('next'), 302); }",
      filename: TS,
      errors: [{ ...error, data: { url: "url.searchParams.get('next')" } }],
    },
    {
      code: "import { redirect as go } from '@sveltejs/kit'; export function load({ url }) { go(url.searchParams.get('next')); }",
      filename: TS,
      errors: [{ ...error, data: { url: "url.searchParams.get('next')" } }],
    },
    {
      code: "import * as kit from '@sveltejs/kit'; export function load() { kit.redirect(target); }",
      filename: TS,
      errors: [{ ...error, data: { url: 'target' } }],
    },
    {
      code: "import * as kit from '@sveltejs/kit'; export function load() { kit.redirect(target, 307); }",
      filename: TS,
      errors: [{ ...error, data: { url: 'target' } }],
    },
    // A header name a runtime piece can finish into Location.
    { code: "res.set('Loc' + n, req.query.u);", filename: TS, errors: [error] },
    { code: 'res.setHeader(`loc${n}`, req.query.u);', filename: TS, errors: [error] },
    { code: "res.header(n + 'ation', req.query.u);", filename: TS, errors: [error] },
    { code: "res.set({ ['Loc' + n]: req.query.u });", filename: TS, errors: [error] },
    // A header name joined from more than 16 possible texts.
    {
      code: "function h(req, res) { let a = 'L'; if (c) a = 'l'; let b = 'o'; if (c) b = 'O'; let d = 'c'; if (c) d = 'C'; let e = 'a'; if (c) e = 'A'; let f = 'tion'; if (c) f = 'TION'; res.set(a + b + d + e + f, req.query.u); }",
      filename: TS,
      errors: [error],
    },
    // A relative prefix that can still grow into a scheme that leaves the origin, in any case.
    { code: 'res.redirect(`ht${x}`);', filename: TS, errors: [error] },
    { code: 'res.redirect(`dat${x}`);', filename: TS, errors: [error] },
    { code: "res.redirect('vb' + x);", filename: TS, errors: [error] },
    { code: 'res.redirect(`File${x}`);', filename: TS, errors: [error] },
    { code: 'res.redirect(`JAVASCRIPT${x}`);', filename: TS, errors: [error] },
    { code: 'res.redirect(`view-sou${x}`);', filename: TS, errors: [error] },
    { code: 'res.redirect(`w${x}`);', filename: TS, errors: [error] },
    // A cyclic alias of a Location name or holder is still read, and read once.
    { code: cyclic("'Location'", 40, 'res.set(p, req.query.u);'), filename: TS, errors: [error] },
    { code: cyclic('{}', 40, 'p.Location = req.query.u; res.set(p);'), filename: TS, errors: [error] },
    { code: cyclic('{}', 40, 'q.Location = req.query.u; res.writeHead(302, p);'), filename: TS, errors: [error] },
  ],
});

/**
 * A header name passed down six `const` aliases into `N`, then written into
 * `N` again straight from `V`. `wrap` dresses each link (a template, a `+ ''`).
 */
const aliasChain = (name: string, sink: string, wrap = (link: string): string => link): string => {
  const links = [6, 5, 4, 3, 2, 1].map((i) => `const c${i} = ${wrap(i === 6 ? 'V' : `c${i + 1}`)};`).join(' ');
  return `function h(req, res) { const L = '${name}'; const V = L; ${links} let N = c1; N = V; ${sink} }`;
};
/** `a0` set to `name`, then `n` aliases each set to the one before. */
const longAliases = (name: string, n: number, sink: string): string =>
  `function h(req, res) { const a0 = '${name}'; ${Array.from({ length: n }, (_, i) => `const a${i + 1} = a${i};`).join(' ')} ${sink.replaceAll('NAME', `a${n}`)} }`;

// A header name read through a long alias chain is the same name however
// deep the binding was first met.
ruleTester.run('no-user-controlled-redirect: long alias chains', noUserControlledRedirectRule, {
  valid: [
    { code: aliasChain('X-Trace', 'res.set(N, req.query.x);'), filename: TS },
    { code: aliasChain('X-Trace', 'res.writeHead(302, { [N]: req.query.x });'), filename: TS },
    { code: aliasChain('X-Trace', 'res.set(N, req.query.x);', (link) => `\`\${${link}}\``), filename: TS },
    { code: longAliases('X-Trace', 100, 'res.set(NAME, req.query.x);'), filename: TS },
  ],
  invalid: [
    { code: aliasChain('Location', 'res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: aliasChain('Location', 'res.writeHead(302, { [N]: req.query.x });'), filename: TS, errors: [error] },
    { code: aliasChain('Location', 'res.set(N, req.query.x);', (link) => `\`\${${link}}\``), filename: TS, errors: [error] },
    { code: aliasChain('Location', 'res.set(N, req.query.x);', (link) => `${link} + ''`), filename: TS, errors: [error] },
    {
      code: aliasChain('Location', 'res.writeHead(302, { [N]: req.query.x });', (link) => `\`\${${link}}\``),
      filename: TS,
      errors: [error],
    },
    { code: aliasChain('Location', 'res.setHeader(`${N}`, req.query.x);'), filename: TS, errors: [error] },
    { code: aliasChain('Loc', "res.set(N + 'ation', req.query.x);", (link) => `${link} + ''`), filename: TS, errors: [error] },
    { code: longAliases('Location', 100, 'res.set(NAME, req.query.x);'), filename: TS, errors: [error] },
    // Past 256 aliases in one chain the name may be anything.
    { code: longAliases('Location', 300, 'res.set(NAME, req.query.x);'), filename: TS, errors: [error] },
  ],
});

// Relative text that can still grow into a scheme an operating system
// protocol handler opens.
ruleTester.run('no-user-controlled-redirect: protocol handler schemes', noUserControlledRedirectRule, {
  valid: [
    { code: 'res.redirect(`docs${req.query.p}`);', filename: TS },
    { code: 'res.redirect(`about${req.query.p}`);', filename: TS },
  ],
  invalid: [
    ...['m', 'ms', 'ms-', 'MS-MSDT', 'ms-officecmd', 'se', 'search', 'search-m', 'vscode', 'itms-', 'mk', 'hc', 'mhtml'].map((prefix) => ({
      code: `res.redirect(\`${prefix}\${req.query.p}\`);`,
      filename: TS,
      errors: [error],
    })),
    { code: "res.redirect('ms-' + req.query.p);", filename: TS, errors: [error] },
    { code: "res.set('Location', `ms-${req.query.p}`);", filename: TS, errors: [error] },
  ],
});

/** `r` and `x2` alias each other, `x2` is also `Location` and `r` is `x2` joined with more text. */
const joinCycle = (start: string, join: string, sink: string): string =>
  `function h(req, res) { let r = ${start}; let x2 = r; x2 = 'Location'; r = ${join}; ${sink} }`;

// Bindings in a cycle that joins text: each keeps the shapes it can take,
// whichever binding the sink reads first.
ruleTester.run('no-user-controlled-redirect: cycles with joins', noUserControlledRedirectRule, {
  valid: [
    {
      code: "function h(req, res) { let r = ''; let x2 = r; x2 = 'X-Trace'; r = x2 + '-B'; let N = r; N = x2; res.set(N, req.query.x); }",
      filename: TS,
    },
    { code: joinCycle("''", "x2 + '-B'", 'res.set(r, req.query.x);'), filename: TS },
  ],
  invalid: [
    { code: joinCycle("''", "x2 + '-B'", 'let N = r; N = x2; res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("''", "x2 + '-B'", 'let N = x2; N = r; res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("'X-'", "x2 + 'Y'", 'let N = r; N = x2; res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("'X-'", "x2 + 'Y'", 'let N = x2; N = r; res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("''", "x2 + '-B'", 'res.set(r + x2, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("''", "x2 + '-B'", 'res.set(`${r}${x2}`, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("''", "x2 + '-B'", 'res.writeHead(302, { [r + x2]: req.query.x });'), filename: TS, errors: [error] },
    // A cycle of three bindings, each joined onto the next.
    {
      code: "function h(req, res) { let a = ''; let b = a; let c = b; c = 'Location'; a = c + '-B'; b = a + '-C'; let N = a; N = b; N = c; res.set(N, req.query.x); }",
      filename: TS,
      errors: [error],
    },
    {
      code: "function h(req, res) { let a = ''; let b = a; let c = b; c = 'Location'; a = c + '-B'; b = a + '-C'; res.set(a + c, req.query.x); }",
      filename: TS,
      errors: [error],
    },
    // A template join.
    { code: joinCycle("''", '`${x2}-B`', 'let N = r; N = x2; res.set(N, req.query.x);'), filename: TS, errors: [error] },
    { code: joinCycle("''", '`${x2}-B`', 'res.set(`${r}${x2}`, req.query.x);'), filename: TS, errors: [error] },
  ],
});
