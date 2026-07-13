/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-contracts/zod-schema-naming': 'error',
  'noctcore-contracts/wire-message-naming': 'error',
  'noctcore-contracts/no-error-stringify': 'error',
  'noctcore-contracts/no-direct-process-env': 'error',
  'noctcore-contracts/money-must-be-decimal': 'error',
  'noctcore-contracts/require-error-cause': 'error',
  'noctcore-contracts/restrict-throw-to-taxonomy': 'error',
  // Config-required / heuristic rules ship inert. `require-registered-keys` and
  // `env-var-schema-parity` do nothing until their `sinks` / `schema` options are
  // set; `require-schema-parse-at-boundary` is a conservative syntactic slice of a
  // type-aware concern. Enable them explicitly once configured for your project.
  'noctcore-contracts/require-registered-keys': 'off',
  'noctcore-contracts/env-var-schema-parity': 'off',
  'noctcore-contracts/require-schema-parse-at-boundary': 'off',
} as const;
