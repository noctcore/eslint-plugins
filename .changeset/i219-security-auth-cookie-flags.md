---
'@noctcore/eslint-plugin-security': minor
---

Add the opt-in `auth-cookie-flags` rule. It reports an auth cookie written without safe flags, in five call shapes: `cookie.<name>.set(opts)`, a bare `set(name, value, opts)`, `<any>.setCookie(name, value, opts)` (Fastify), `<any>.cookie(name, value, opts)` (Express) and `cookies().set(name, value, opts)` (Next.js, awaited or not). The cookie name must be a static string. `httpOnly` passes only as literal `true`; `secure` passes as literal `true` or any non-literal (such as `isProd`); `sameSite` passes as `'lax'`, `'strict'` or `'none'` in any case, or as a non-literal, and `sameSite: 'none'` also needs literal `secure: true`. Each missing or wrong flag draws its own report naming the flag; a non-auth name, a non-literal name and a `set` on any other receiver (such as a `Map`) are left alone.

Four options: `require` (default all three flags) narrows the flags checked; `authCookieNames` (default `['auth_token', 'session', 'sid', 'authToken']`, exact match) is replaced, not extended, by a configured list; `authCookiePattern` (unset by default) is a regular-expression source whose matches are checked in addition to `authCookieNames`; `trustedConfigNames` (default `[]`) names shared cookie configs, so a spread of one, or a whole options argument named there, counts as setting every flag the object does not write itself, while a flag written next to it (such as `httpOnly: false`) is still reported.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. Enable it with `'noctcore-security/auth-cookie-flags': 'error'`, or with your own options.
