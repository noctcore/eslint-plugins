/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs/recommended.test.ts` fails if a `warn` comes back.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them.
 */
export const recommended = {
  // Precise, syntactic — safe as errors.
  'noctcore-async-safety/require-fetch-timeout': 'error',
  // A dead `signal` parameter is a real bug (the cancel never reaches the I/O), and
  // the rule counts any forwarding shape as a pass, so it errs toward silence.
  'noctcore-async-safety/forward-abort-signal': 'error',
  // A lost update is a real bug, and the rule skips order-tolerant writes
  // (`push`, `set`, distinct-index) and plain overwrites.
  'noctcore-async-safety/no-concurrent-shared-mutation': 'error',
  // A timer left pending after the race is a real leak, and any `clearTimeout` of the
  // handle after the race (or a handle the rule cannot follow) counts as a pass.
  'noctcore-async-safety/no-leaky-race-timeout': 'error',
  // Ships OFF: a latency hint, not a correctness bug. Sequential awaits are often
  // deliberate (one transaction client, rate limits, deterministic test setup), and
  // the rule cannot see that. Enable it where you want the nudge.
  'noctcore-async-safety/prefer-parallel-awaits': 'off',
} as const;
