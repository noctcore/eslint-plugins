---
'@noctcore/eslint-plugin-security': minor
---

`no-user-controlled-redirect` now checks the other ways Express and Fastify send a redirect: `res.location(url)` (added to the default `redirectCallees`), and `Location` header writes on a receiver in the new `responseObjects` option (default `res`, `response`, `reply`): `set` / `header` / `setHeader` with the header name in any case, `set({ Location })` and `writeHead(status, { Location })`. A sink after response-returning calls is read too: `res.status(302).set('Location', url)`, `reply.code(302).header(...)`, `res.status(302).redirect(url)`.

It also stops reporting a host-pinned target: a URL whose `new URL(url).hostname` (or `.host` / `.origin`) was checked by an exiting `if`, or an `if` around the redirect, against `includes` / `has` / `===` on literals or an anchored regex whose every alternative ends in a literal domain (`^(app|docs)\.example\.com$`), with no write to the URL after the read.

A project spreading `recommended` can see new errors where it sets a `Location` header to a runtime URL; each is an open redirect unless the host is checked as above.
