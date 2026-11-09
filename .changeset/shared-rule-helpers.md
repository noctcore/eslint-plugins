---
'@noctcore/eslint-utils': minor
'@noctcore/eslint-plugin-architecture': patch
'@noctcore/eslint-plugin-async-safety': patch
'@noctcore/eslint-plugin-code-quality': patch
'@noctcore/eslint-plugin-contracts': patch
'@noctcore/eslint-plugin-observability': patch
'@noctcore/eslint-plugin-prisma': patch
'@noctcore/eslint-plugin-react': patch
'@noctcore/eslint-plugin-security': patch
---

`@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.

Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
