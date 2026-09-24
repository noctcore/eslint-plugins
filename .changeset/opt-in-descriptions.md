---
'@noctcore/eslint-plugin-security': patch
'@noctcore/eslint-plugin-architecture': patch
---

Documentation only, no rule behaviour change. The `meta.docs.description` of `require-path-containment`, `server-action-through-client` (security) and `colocated-test-required` (architecture) no longer ends with an "opt-in" note: the rules table and rule page now show that with 🔘. The rules are still left out of `recommended`, so a project that spreads the preset as-is sees no change.
