---
"@noctcore/eslint-plugin-architecture": minor
---

Add `single-semantic-module`, ported from `@boring-stack-pkg/eslint-plugin-module-boundaries` 0.2.0 (MIT) so it runs on ESLint 10. A module's exported declarations are classified by AST shape into `type`, `constant`, `function`, `class`, `react-component`, `hook`, `schema` or `enum`, and a mix is reported unless an `allow` group covers it. `ignorePrivateDeclarations` defaults to `true`, so a private render helper or filter constant is not a second concern, and a declaration exported later by name (`export { x }`, `export default X`) counts as exported. Ships `off` in `recommended`.
