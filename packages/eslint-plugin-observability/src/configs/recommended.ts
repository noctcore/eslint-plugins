/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs.test.ts` fails if a `warn` comes back.
 *
 * `no-sensitive-fields-in-logs` is a name-only heuristic, but it is segment-aware
 * and the cost of a miss (a credential in a long-lived log sink) outweighs the cost
 * of a false positive (a rename or an explicit `redact()`), so it ships at `error`.
 */
export const recommended = {
  'noctcore-observability/structured-log-arguments': 'error',
  'noctcore-observability/no-sensitive-fields-in-logs': 'error',
  'noctcore-observability/no-error-detail-loss': 'error',
  // Inert until you set `auditCallees`, so it ships enabled but checks nothing by default.
  'noctcore-observability/audit-pii-declared': 'error',
} as const;
