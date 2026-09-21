/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * `no-sensitive-fields-in-logs` is a name-only HEURISTIC (it can't prove a value
 * is a secret), so it ships at `warn` rather than `error`.
 */
export const recommended = {
  'noctcore-observability/structured-log-arguments': 'error',
  'noctcore-observability/no-sensitive-fields-in-logs': 'warn',
  'noctcore-observability/no-error-detail-loss': 'error',
  // Inert until you set `auditCallees`, so it ships enabled but checks nothing by default.
  'noctcore-observability/audit-pii-declared': 'error',
} as const;
