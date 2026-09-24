---
'@noctcore/eslint-plugin-architecture': patch
'@noctcore/eslint-plugin-async-safety': patch
'@noctcore/eslint-plugin-code-quality': patch
'@noctcore/eslint-plugin-contracts': patch
'@noctcore/eslint-plugin-llm': patch
'@noctcore/eslint-plugin-monorepo': patch
'@noctcore/eslint-plugin-observability': patch
'@noctcore/eslint-plugin-prisma': patch
'@noctcore/eslint-plugin-react': patch
'@noctcore/eslint-plugin-rsc': patch
'@noctcore/eslint-plugin-security': patch
'@noctcore/lint-meta-rules': patch
---

Documentation only, no rule behaviour change. The README now follows the same layout in every
package: requirements, install, a quick start with `files` and the TypeScript parser, one config
block for every opt-in rule, the rules table and the severity policy. Every rule doc now has the same
sections in the same order: why, what it flags, what it does not flag, options, when not to use it.
