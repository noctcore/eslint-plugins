# @noctcore/eslint-plugin-observability

## 0.3.0

### Minor Changes

- [`cf4a5be`](https://github.com/noctcore/eslint-plugins/commit/cf4a5be8b0e57699b2b3b3f95f04dc6c1970acb3) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` presets no longer ship any rule at `warn`. House policy is `error` or `off`: a
  warning is a rule nobody obeys. A test in each package now fails if a preset emits `warn` again.

  `@noctcore/eslint-plugin-async-safety`:

  - `forward-abort-signal`: `warn` to `error`. A dead `signal` parameter is a real bug, and the rule
    already counts any forwarding shape as a pass.
  - `no-concurrent-shared-mutation`: `warn` to `error`. A lost update is a real bug, and the rule
    already skips order-tolerant writes and plain overwrites.
  - `prefer-parallel-awaits`: `warn` to `off`. It is a latency hint, not a correctness bug, and
    sequential awaits are often deliberate (one transaction client, rate limits, ordered test setup).
    Enable it yourself where you want the nudge.

  `@noctcore/eslint-plugin-observability`:

  - `no-sensitive-fields-in-logs`: `warn` to `error`. A miss leaks a credential into a long-lived log
    sink; a false positive costs a rename or an explicit `redact()`. Turn it off in config for tests
    that log a secret on purpose to prove a redaction boundary.

  This can surface new errors in projects that use the preset as-is, hence the minor bump.

## 0.2.0

### Minor Changes

- [`23e4fe1`](https://github.com/noctcore/eslint-plugins/commit/23e4fe19f16ce64c912957cc7aa6f797b31e9660) Thanks [@Shironex](https://github.com/Shironex)! - Add `audit-pii-declared`: a PII-shaped key written into an audit payload (`metadata`, `before`, `after`) must be declared, either in `registeredFields` (the keys a purge job scrubs) or in `nonPiiFields`. Payloads it cannot read are reported unless `reportOpaque` is off. It enforces declaration, not deletion, and is inert until `auditCallees` is set. Enabled at `error` in `recommended`. `no-sensitive-fields-in-logs` now shares its name matcher from `utils`, with no behavior change.
