---
'@noctcore/eslint-utils': minor
---

`NoctcoreRuleDocs` accepts three optional fields, `cwe` (CWE ids as `CWE-<n>`), `owasp` (OWASP Top 10 ids as `A<nn>:<year>`) and `securitySeverity` (a CVSS-like score from 0 to 10), so a rule built with `makeCreateRule` can declare the weakness it reports. Nothing reads them at lint time.
