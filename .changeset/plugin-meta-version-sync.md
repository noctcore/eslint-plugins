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

Report the real package version in `meta.version`.

Every plugin published a `meta.version` taken from a literal in its source while the
version itself came from changesets, so the two drifted: all nine were behind, contracts
by three minors (it said `0.3.0` while publishing `0.6.0`) and prisma by two (`0.1.0`
against `0.3.1`). ESLint reads that field to identify a plugin, so anything keyed on
plugin identity saw a build that had not existed for months.

The constant is now written from package.json during `version-packages`, and a test
compares the two so they cannot drift apart again.
