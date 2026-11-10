---
'@noctcore/eslint-utils': minor
'@noctcore/eslint-plugin-async-safety': minor
'@noctcore/eslint-plugin-contracts': minor
'@noctcore/eslint-plugin-security': minor
---

The three fetch rules now take one shared wrapper list under one option name, `fetchCallees`, so a project declares its fetch wrapper once and passes the same list to all of them:

```js
const fetchCallees = ['fetch', 'http.fetchWithCsrfRetry'];
// async-safety/require-fetch-timeout, contracts/fetch-must-check-ok,
// security/no-user-controlled-fetch-url: ['error', { fetchCallees }]
```

An entry is a string (`'http.fetchWithRetry'`: the last segment is the method, the rest is the receiver as written) or an object (`{ object: 'axios', name: 'get', urlArgument: 0, urlProperty: 'url' }`). The URL position is read only by the security rule.

- async-safety `require-fetch-timeout`: new `fetchCallees`; `callees` is a deprecated alias kept through 1.x (both lists are combined). The global `fetch` is still always checked. A wrapper rooted at `this` (`this.api.get`) can now be listed.
- contracts `fetch-must-check-ok`: new `fetchCallees`; `fetchFunctions` is a deprecated alias kept through 1.x (both lists are combined; with neither set the default is still `['fetch']`).
- security `no-user-controlled-fetch-url` and `no-user-controlled-redirect`: `fetchCallees` and `redirectCallees` now also accept the string form.

Nothing breaks and the defaults are unchanged, so a project that spreads `recommended` sees no new reports. `@noctcore/eslint-utils` adds `matchFetchCallee`, `normalizeFetchCallees`, `toFetchCalleeSpec`, `fetchCalleeText`, `fetchCalleesSchema`, `fetchCalleeEntrySchema` and the `FetchCalleeSpec` / `FetchCalleeEntry` types.
