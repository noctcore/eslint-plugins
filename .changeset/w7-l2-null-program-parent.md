---
"@noctcore/eslint-plugin-react": patch
---

`max-hook-return-surface` no longer crashes on a top-level `return` in a hook file. Its enclosing-function walk stopped only on `undefined`, but `Program.parent` is `null` at runtime, so the walk dereferenced `null` once it climbed past `Program`.
