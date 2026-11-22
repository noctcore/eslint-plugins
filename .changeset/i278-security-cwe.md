---
'@noctcore/eslint-plugin-security': minor
---

Every rule now names the weakness it reports: `meta.docs.cwe` (for example `['CWE-78']` on `no-shell-interpolation`) and `meta.docs.owasp` (OWASP Top 10 2021, for example `['A03:2021']`). The README lists the mapping.

New entry point `@noctcore/eslint-plugin-security/sarif`: an ESLint formatter that runs `@microsoft/eslint-formatter-sarif` (now an optional peer dependency) and adds `security`, `external/cwe/cwe-NNN` and `external/owasp/...` tags to every SARIF rule that declares ids, so GitHub code scanning and SARIF scorers can classify findings. The Microsoft formatter alone drops these fields. Use it by path: `eslint -f ./node_modules/@noctcore/eslint-plugin-security/dist/sarif.js -o eslint.sarif .`. `addTaxonomyTags(log, rulesMeta)` does the same to a SARIF log you already have.

No rule reports anything new, so a project spreading `recommended` sees no new errors.
