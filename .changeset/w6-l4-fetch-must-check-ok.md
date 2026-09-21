---
"@noctcore/eslint-plugin-contracts": minor
---

Add `fetch-must-check-ok`: a fetch response must be checked with `.ok` or a status comparison before `.json()` parses its body. Ported from tsforge `typescript-core/fetch-must-check-ok` (MIT) with its full test suite. Adds a `fetchFunctions` option (default `['fetch']`) for wrappers and dotted callees. On at `error` in `recommended`.
