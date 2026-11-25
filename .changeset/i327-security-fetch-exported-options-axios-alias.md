---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-fetch-url` no longer reads an exported `const` options object as fixed, since an importing module can change it (`as const` freezes only the type), and now sees `axios` and an `axios.create(...)` instance behind a type wrapper or an alias (`(axios as any).get(url)`, `const ax = axios`).
