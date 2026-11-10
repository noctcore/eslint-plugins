---
'@noctcore/eslint-utils': minor
'@noctcore/eslint-plugin-architecture': minor
'@noctcore/eslint-plugin-contracts': minor
'@noctcore/eslint-plugin-prisma': minor
---

File exemptions are now called `allowIn` in every plugin, like the rules that already used that name (code-quality, react, dates, electron, prisma `tenant-scoped-tables-require-where` and `soft-deletable-tables-require-deleted-at`).

| Rule | New option | Deprecated alias |
| --- | --- | --- |
| architecture `barrel-purity` | `allowIn` | `allow` |
| architecture `colocated-test-required` | `allowIn` | `ignore` |
| architecture `component-folder-structure` | `allowIn` (default `['**/ui/**']`) | `ignorePaths` |
| architecture `filename-matches-export` | `allowIn` | `ignore` |
| architecture `index-must-reexport-default` | `allowIn` | `ignorePaths` |
| contracts `money-must-be-decimal` | `allowIn` | `allowedFiles` |
| contracts `no-direct-process-env` | `allowIn` | `allowedFiles` |
| prisma `no-raw-sql-outside-allowlist` | `allowIn` | `allowedFiles` |
| prisma `no-unscoped-prisma-outside-allowlist` | `allowIn` | `allowedFiles` |

Nothing breaks: the old names keep working through 1.x. When both the old name and `allowIn` are set, their globs are combined; when neither is set, the rule's default list applies as before. Scope options that turn a rule on (`include`, `files`) and prisma `restrict-model-writes` `restrictions[].allowedFiles` (who may write a model) keep their names.

`@noctcore/eslint-utils` adds `resolveAllowIn(options, aliases, defaults)` and `allowInAliasDescription(alias)` for rules that read the option.
