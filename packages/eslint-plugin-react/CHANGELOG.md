# @noctcore/eslint-plugin-react

## 0.3.0

### Minor Changes

- [`bc5d82f`](https://github.com/noctcore/eslint-plugins/commit/bc5d82ff4871f2b865aaf0441516f73a58324fc6) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-plugin-react`: **behaviour change for consumers.** The `recommended` preset no
  longer ships any rule at `warn`. House policy is `error` or `off`: a warning is a rule nobody obeys,
  and a project that refuses `warn` in its resolved config could not use the preset at all.

  - `no-effect-derived-state`: `warn` to `error`. It fires only on an effect whose whole body is
    `setX(...)` of values read from its own deps; any branch, call, await or cleanup bails out.
  - `require-effect-cancellation`: `warn` to `error`. A state update after an await with nothing to
    cancel it is a real bug, and any recognisable guard (an `AbortController`, a `cancelled` flag, a
    cleanup `return`) silences it.

  Projects that spread `react.configs.recommended` as-is will now fail lint on findings that used to
  print as warnings. To keep the old behaviour, set either rule back yourself after the preset. A test
  in every plugin now fails if any preset emits `warn`.

  `@noctcore/eslint-plugin-contracts`: `money-must-be-decimal` gains a `minorUnitPatterns` option.
  Payment APIs such as Stripe carry money as an integer count of minor units (`amount: 1999` is
  19.99), which is exact in a `number`. List the regex fragments (case-insensitive, unanchored, so
  anchor them: `['^amount$', 'Cents$']`) that name such fields and the rule skips them. The default is
  empty, so nothing changes until you opt in.

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.1

### Patch Changes

- [`3cc17aa`](https://github.com/noctcore/eslint-plugins/commit/3cc17aa9c882ff1be503476536dccd6fc2197b29) Thanks [@Shironex](https://github.com/Shironex)! - `max-hook-return-surface` no longer crashes on a top-level `return` in a hook file. Its enclosing-function walk stopped only on `undefined`, but `Program.parent` is `null` at runtime, so the walk dereferenced `null` once it climbed past `Program`.

## 0.2.0

### Minor Changes

- Add 5 rules: `prefer-lazy-state-init` (fixable), `no-jsx-in-hooks`, `component-props-naming` (fixable), and conservative `warn`-level `require-effect-cancellation` and `no-effect-derived-state`.
