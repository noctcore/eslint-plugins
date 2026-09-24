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
'@noctcore/eslint-utils': patch
---

Documentation only, no rule behaviour change. Each package's npm page now links to its page on the
docs site (`homepage` and a **Docs** link at the top of the README), and every plugin README states
its requirements: ESLint 9 or newer, flat config only, and a `recommended` preset that sets no `files`
and no parser, with a snippet for linting TypeScript. `@noctcore/eslint-utils` ships a README. Rule
docs describe what a rule does today; third-party credits moved to a short section at the end.
