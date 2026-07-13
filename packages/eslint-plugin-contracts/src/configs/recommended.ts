/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-contracts/zod-schema-naming': 'error',
  'noctcore-contracts/wire-message-naming': 'error',
  'noctcore-contracts/no-error-stringify': 'error',
  'noctcore-contracts/no-direct-process-env': 'error',
  'noctcore-contracts/money-must-be-decimal': 'error',
} as const;
