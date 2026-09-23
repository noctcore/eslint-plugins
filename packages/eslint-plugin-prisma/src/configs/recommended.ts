/*
 * Rule id -> severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * A rule is here when its defaults hold on production source with no project
 * knowledge. Test setup legitimately performs several writes outside a
 * transaction, so a project that lints its specs usually scopes
 * `prisma-write-in-transaction` to production files with a `files`/`ignores`
 * block rather than relying on the preset alone.
 *
 * Deliberately NOT here, because each needs the project's own registry and does
 * nothing without it: `tenant-scoped-tables-require-where` and
 * `tenant-write-must-carry-tenant-id` (`tenantModels`),
 * `soft-deletable-tables-require-deleted-at` (`softDeleteModels`) and
 * `restrict-model-writes` (`restrictions`). A preset entry that reports nothing
 * would read as coverage the project does not have.
 *
 * Also not here: `mutation-entry-must-reach-audit`, which needs type
 * information and throws without it, so a preset entry would break every
 * untyped lint that spreads the preset.
 */
export const recommended = {
  'noctcore-prisma/no-audit-write-in-transaction': 'error',
  'noctcore-prisma/no-cross-tenant-id-in-where': 'error',
  'noctcore-prisma/no-raw-sql-outside-allowlist': 'error',
  'noctcore-prisma/no-request-body-in-write': 'error',
  'noctcore-prisma/no-unscoped-prisma-outside-allowlist': 'error',
  'noctcore-prisma/prisma-tx-uses-tx-not-client': 'error',
  'noctcore-prisma/prisma-write-in-transaction': 'error',
} as const;
