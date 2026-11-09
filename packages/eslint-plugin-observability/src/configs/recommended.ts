/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs/recommended.test.ts` fails if a `warn` comes back.
 *
 * `no-sensitive-fields-in-logs` is a name-only heuristic, but it is segment-aware
 * and the cost of a miss (a credential in a long-lived log sink) outweighs the cost
 * of a false positive (a rename or an explicit `redact()`), so it ships at `error`.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them.
 */
export const recommended = {
  'noctcore-observability/structured-log-arguments': 'error',
  'noctcore-observability/no-sensitive-fields-in-logs': 'error',
  'noctcore-observability/no-error-detail-loss': 'error',
} as const;
