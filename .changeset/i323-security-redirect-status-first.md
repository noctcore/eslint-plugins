---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` reads the location of SvelteKit's `redirect(status, location)`. The default `redirect` sink read argument 0, so `redirect(302, next)` checked the status code and stayed silent. A call whose argument 0 is a number literal, or a `redirect` imported from `@sveltejs/kit` (also under another name or through `import * as kit`), is now read at argument 1. The one-argument `redirect(url)` of Next.js and Remix is read at argument 0 as before.
