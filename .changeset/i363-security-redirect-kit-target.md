---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` reads argument 0 of a `redirect` imported from `@sveltejs/kit` when it is the only argument or argument 1 is a number literal, so `throw redirect(url.searchParams.get('next'))` and `redirect(next, 302)` are reported again. A kit call with a second argument that is not a number literal still reads argument 1.
