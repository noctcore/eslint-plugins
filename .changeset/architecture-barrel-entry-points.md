---
'@noctcore/eslint-plugin-architecture': patch
---

`barrel-purity` only treats an `index.*` file as a barrel once it re-exports from another module (`export … from` or `export * from`). A server or package entry point named `index.ts` (`const app = createServer(); app.listen(3000)`, or a plugin entry that builds its object and exports an imported binding) no longer reports.
