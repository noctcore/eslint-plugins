---
"@noctcore/eslint-plugin-async-safety": minor
"@noctcore/eslint-plugin-observability": minor
---

The `recommended` presets no longer ship any rule at `warn`. House policy is `error` or `off`: a
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
