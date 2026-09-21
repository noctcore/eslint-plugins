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
    { code: `NextResponse.redirect('https://example.com/login');`, filename: TS },
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
    { code: 'res.redirect(sanitizeReturnTo(req.query.next));', filename: TS, options: [APP_URL_TRUST] },
    // TanStack Router: an options object names a route via `to`, not a location.
    { code: `throw redirect({ to: '/auth/login', search: { redirect: location.href } });`, filename: TS },
    { code: `throw redirect({ to: LOGIN_PATH, search });`, filename: TS },
    // ...and a literal `href` is fine.
    { code: `throw redirect({ href: 'https://example.com/docs' });`, filename: TS },
    // Not a redirect callee by default (`ctx.redirect` needs configuring).
    { code: 'ctx.redirect(url);', filename: TS },
    // A status code is not the URL in the single-argument-last shape.
    { code: `res.redirect('/done');`, filename: TS },
  ],
  invalid: [
    // Plain user input.
    { code: 'redirect(searchParams.get("next"));', filename: TS, errors: [error] },
    { code: 'res.redirect(req.query.next);', filename: TS, errors: [error] },
    // Express two-argument form is recognised: the runtime URL in position 1 reports.
    { code: 'res.redirect(302, req.query.next);', filename: TS, errors: [error] },
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
    { code: 'throw redirect({ href: search.next });', filename: TS, errors: [error] },
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
      options: [{ redirectCallees: [{ object: 'ctx', name: 'redirect', urlArgument: 1 }] }],
      errors: [error],
    },
  ],
});
