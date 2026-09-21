# @noctcore/eslint-plugin-react

## 0.2.1

### Patch Changes

- [`3cc17aa`](https://github.com/noctcore/eslint-plugins/commit/3cc17aa9c882ff1be503476536dccd6fc2197b29) Thanks [@Shironex](https://github.com/Shironex)! - `max-hook-return-surface` no longer crashes on a top-level `return` in a hook file. Its enclosing-function walk stopped only on `undefined`, but `Program.parent` is `null` at runtime, so the walk dereferenced `null` once it climbed past `Program`.

## 0.2.0

### Minor Changes

- Add 5 rules: `prefer-lazy-state-init` (fixable), `no-jsx-in-hooks`, `component-props-naming` (fixable), and conservative `warn`-level `require-effect-cancellation` and `no-effect-derived-state`.
