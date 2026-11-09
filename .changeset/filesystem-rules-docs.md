---
'@noctcore/eslint-plugin-architecture': patch
'@noctcore/eslint-plugin-code-quality': patch
'@noctcore/eslint-plugin-contracts': patch
'@noctcore/eslint-plugin-monorepo': patch
'@noctcore/eslint-plugin-prisma': patch
---

Docs only: every rule that reads another file (a schema, a catalog, a directory listing, a workspace manifest) now says so, notes that `eslint --cache` keeps the old result when that file changes, and links the new "Rules that read other files" page. No rule behaviour changes.
