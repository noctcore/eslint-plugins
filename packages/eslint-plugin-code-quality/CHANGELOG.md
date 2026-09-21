# @noctcore/eslint-plugin-code-quality

## 0.2.0

### Minor Changes

- [`11a7e3d`](https://github.com/noctcore/eslint-plugins/commit/11a7e3d6dbafbdad16398d3d7b01a88a8806d736) Thanks [@Shironex](https://github.com/Shironex)! - Add four test-hygiene rules ported from tsforge (MIT), all on in `recommended`: `no-vacuous-expect`, `no-conditional-expect`, `fake-timers-must-be-restored` and `no-real-network-in-unit-tests`. `fake-timers-must-be-restored` accepts a restore that lives in a shared suite the file imports and calls (`followImportedSuites`, `sharedSuiteModules`). `no-conditional-expect` does not treat loops as conditional unless `checkLoops` is set.
