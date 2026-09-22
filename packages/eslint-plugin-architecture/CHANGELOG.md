# @noctcore/eslint-plugin-architecture

## 0.3.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.3.0

### Minor Changes

- [`97b2648`](https://github.com/noctcore/eslint-plugins/commit/97b264831de668a78128dc05034c288e955d99b8) Thanks [@Shironex](https://github.com/Shironex)! - Add `single-semantic-module`, ported from `@boring-stack-pkg/eslint-plugin-module-boundaries` 0.2.0 (MIT) so it runs on ESLint 10. A module's exported declarations are classified by AST shape into `type`, `constant`, `function`, `class`, `react-component`, `hook`, `schema` or `enum`, and a mix is reported unless an `allow` group covers it. `ignorePrivateDeclarations` defaults to `true`, so a private render helper or filter constant is not a second concern, and a declaration exported later by name (`export { x }`, `export default X`) counts as exported. Ships `off` in `recommended`.

## 0.2.0

### Minor Changes

- Add 4 rules: `barrel-purity`, `filename-matches-export` (suggestion fix), `colocated-test-required` (opt-in), and `max-import-depth` (conditional fix).
