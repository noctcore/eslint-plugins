---
'@noctcore/eslint-plugin-observability': patch
'@noctcore/eslint-plugin-security': patch
---

Internal: use `calleeName` from `@noctcore/eslint-utils` instead of a private copy, and walk the parser's visitor keys instead of `Object.keys` in `no-sensitive-fields-in-logs` and `no-error-detail-loss`. No report changes. The `no-sensitive-fields-in-logs` options now carry schema descriptions.
