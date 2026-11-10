---
'@noctcore/eslint-plugin-architecture': minor
---

Add `no-restricted-imports-layered`: import bans declared once as named sets and assigned to file layers. Every matching layer adds its sets, so bans merge per file instead of the last config block winning, and static imports, re-exports and dynamic `import()` are all covered. Opt-in, it needs options.

`component-folder-structure` gains a `requireOwnFolder` option that reports a component file sitting loose in a feature folder instead of in its own `<Name>/<Name>.tsx` folder. Its reports now point at the first line of the file instead of the whole file.
