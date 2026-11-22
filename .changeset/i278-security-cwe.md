---
'@noctcore/eslint-plugin-security': minor
---

Every rule now names the weakness it reports: `meta.docs.cwe` (for example `['CWE-78']` on `no-shell-interpolation`), `meta.docs.owasp` (OWASP Top 10 2021, for example `['A03:2021']`) and `meta.docs.securitySeverity` (a CVSS-like score, for example `9.8`). The README lists the mapping.

New entry point `@noctcore/eslint-plugin-security/sarif`: an ESLint formatter, with no dependency, that writes SARIF 2.1.0 (checked against the OASIS schema in the tests) with `security`, `external/cwe/cwe-NNN` and `external/owasp/...` tags and a `security-severity` on every rule that declares them, so GitHub code scanning and SARIF scorers can classify and rank findings. Paths are relative to the working directory under `SRCROOT` (`NOCTCORE_SARIF_ABSOLUTE_URIS=1` writes absolute URIs), `eslint-disable` suppressions are kept with their justification, and parse errors are reported as notifications that mark the run unsuccessful. Use it by path: `eslint -f ./node_modules/@noctcore/eslint-plugin-security/dist/sarif.js -o eslint.sarif .` (`dist/sarif.cjs` works too).

No rule reports anything new, so a project spreading `recommended` sees no new errors.
