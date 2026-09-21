# @noctcore/eslint-plugin-async-safety

## 0.2.0

### Minor Changes

- [`73168a1`](https://github.com/noctcore/eslint-plugins/commit/73168a1970e09c4543b29f88e8616ec12a270bdb) Thanks [@Shironex](https://github.com/Shironex)! - Add `require-client-timeout`: reports a configured client call or `new` whose options object literal sets none of the listed timeout keys. It ships with no built-in client list (`clients: []`, inert by default) and, like `require-fetch-timeout`, stays silent on spreads and opaque option bags. Enabled at `error` in `recommended`.
