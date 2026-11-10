---
'@noctcore/eslint-utils': minor
---

Add `calleeName(callee)`: the called name of a callee (`mask` for `utils.mask(x)`, `this.audit.mask(x)` or `make().mask(x)`), or null for computed access. The observability and security plugins use it in place of their own copies.
