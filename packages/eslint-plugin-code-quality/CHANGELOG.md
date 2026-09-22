# @noctcore/eslint-plugin-code-quality

## 0.2.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.0

### Minor Changes

- [`11a7e3d`](https://github.com/noctcore/eslint-plugins/commit/11a7e3d6dbafbdad16398d3d7b01a88a8806d736) Thanks [@Shironex](https://github.com/Shironex)! - Add four test-hygiene rules ported from tsforge (MIT), all on in `recommended`: `no-vacuous-expect`, `no-conditional-expect`, `fake-timers-must-be-restored` and `no-real-network-in-unit-tests`. `fake-timers-must-be-restored` accepts a restore that lives in a shared suite the file imports and calls (`followImportedSuites`, `sharedSuiteModules`). `no-conditional-expect` does not treat loops as conditional unless `checkLoops` is set.
