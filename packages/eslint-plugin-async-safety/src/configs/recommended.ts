/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs.test.ts` fails if a `warn` comes back.
 */
export const recommended = {
  // Precise, syntactic — safe as errors.
  'noctcore-async-safety/require-fetch-timeout': 'error',
  // Inert until you list `clients`, so it ships enabled but checks nothing by default.
  'noctcore-async-safety/require-client-timeout': 'error',
  // Inert until you set `include` globs, so it ships enabled but off by default.
  'noctcore-async-safety/no-shared-mutable-module-state': 'error',
  // A dead `signal` parameter is a real bug (the cancel never reaches the I/O), and
  // the rule counts any forwarding shape as a pass, so it errs toward silence.
  'noctcore-async-safety/forward-abort-signal': 'error',
  // A lost update is a real bug, and the rule skips order-tolerant writes
  // (`push`, `set`, distinct-index) and plain overwrites.
  'noctcore-async-safety/no-concurrent-shared-mutation': 'error',
  // Ships OFF: a latency hint, not a correctness bug. Sequential awaits are often
  // deliberate (one transaction client, rate limits, deterministic test setup), and
  // the rule cannot see that. Enable it where you want the nudge.
  'noctcore-async-safety/prefer-parallel-awaits': 'off',
} as const;
