/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them.
 *
 * The naming conventions (`zod-schema-naming`, `wire-message-naming`) are in
 * `strict` (`./strict.ts`), not here.
 */
export const recommended = {
  'noctcore-contracts/no-error-stringify': 'error',
  'noctcore-contracts/no-direct-process-env': 'error',
  'noctcore-contracts/money-must-be-decimal': 'error',
  'noctcore-contracts/require-error-cause': 'error',
  'noctcore-contracts/schema-enum-field-consistency': 'error',
  'noctcore-contracts/fetch-must-check-ok': 'error',
  // Ships OFF: a conservative syntactic slice of a type-aware concern. It needs
  // no options, so it is listed here; enable it where you want the check.
  'noctcore-contracts/require-schema-parse-at-boundary': 'off',
} as const;
