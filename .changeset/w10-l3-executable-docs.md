---
'@noctcore/eslint-plugin-architecture': patch
'@noctcore/eslint-plugin-async-safety': patch
'@noctcore/eslint-plugin-code-quality': patch
'@noctcore/eslint-plugin-contracts': patch
'@noctcore/eslint-plugin-monorepo': patch
'@noctcore/eslint-plugin-observability': patch
'@noctcore/eslint-plugin-prisma': patch
'@noctcore/eslint-plugin-react': patch
'@noctcore/eslint-plugin-security': patch
---

Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.
