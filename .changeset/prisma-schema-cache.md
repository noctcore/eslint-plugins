---
'@noctcore/eslint-plugin-prisma': patch
---

The schema reader behind the schema-aware rules (and the exported `loadPrismaSchema`) now caches each `.prisma` file through the shared mtime file cache from `@noctcore/eslint-utils`, and reuses a parse only while every source file is unchanged. Before, a schema folder was keyed on the newest mtime across its files, so editing a file whose mtime stayed below a sibling's (a checkout or copy that preserves timestamps) kept serving the old parse in a long-running ESLint server.
