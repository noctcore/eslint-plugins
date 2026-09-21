/*
 * Rule id -> severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * Every rule is on: each one is precise enough to hold on production source
 * with its defaults. Test setup legitimately performs several writes outside a
 * transaction, so a project that lints its specs usually scopes
 * `prisma-write-in-transaction` to production files with a `files`/`ignores`
 * block rather than relying on the preset alone.
 */
export const recommended = {
  'noctcore-prisma/no-raw-sql-outside-allowlist': 'error',
  'noctcore-prisma/no-unscoped-prisma-outside-allowlist': 'error',
  'noctcore-prisma/prisma-tx-uses-tx-not-client': 'error',
  'noctcore-prisma/prisma-write-in-transaction': 'error',
} as const;
