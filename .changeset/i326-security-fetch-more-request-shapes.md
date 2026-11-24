---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-fetch-url` now reports more ways to move a request: options after the URL that the requester supplies (`https.get(url, req.body)`) or that `Object.assign` builds from a source the rule cannot read, each branch of a conditional options object, a `__proto__` the rule cannot read (it supplies every key the object does not set), a hook such as `agent` held by a `const` that is not author-written, the axios form methods (`postForm`, `putForm`, `patchForm`), every write to `axios.defaults` (a computed key, `Object.assign(axios.defaults, ...)`, replacing it whole, keys such as `proxy`), and undici's `new Client(origin)` and `new Pool(origin)`.
