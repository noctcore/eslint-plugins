---
'@noctcore/eslint-utils': minor
---

`NoctcoreRuleDocs` accepts two optional fields, `cwe` (CWE ids as `CWE-<n>`) and `owasp` (OWASP Top 10 ids as `A<nn>:<year>`), so a rule built with `makeCreateRule` can declare the weakness it reports. Nothing reads them at lint time.
