---
'@noctcore/eslint-plugin-contracts': patch
---

`money-must-be-decimal`: `allowedFiles` entries are now globs (`**/legacy/**`). A plain path is still a path suffix, now matched at a directory boundary, so `totals.ts` no longer exempts `subtotals.ts`. The i18n catalog reader behind `translation-key-exists` now uses the shared mtime file cache from `@noctcore/eslint-utils`; a catalog that exists but cannot be read is still reported as unreadable rather than treated as absent.
