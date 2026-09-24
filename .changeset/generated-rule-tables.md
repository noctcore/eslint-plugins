---
'@noctcore/eslint-utils': patch
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

Documentation only, no rule behaviour change. The rules table in each README is now generated from
the rules' own metadata, with the same columns in every package: in `recommended`, needs options,
fixable, suggestions, needs type information. Rule links point at the docs site. Every rule doc
now opens with a one-line status header saying the same. Rules that do nothing until configured
carry a new `meta.docs.requiresOptions: true`, and `@noctcore/eslint-utils` types that field
(`NoctcoreRuleDocs`). A project that spreads `recommended` sees no new errors.
