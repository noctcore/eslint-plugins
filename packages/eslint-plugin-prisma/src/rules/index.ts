import { noRawSqlOutsideAllowlistRule } from './no-raw-sql-outside-allowlist';
import { noUnscopedPrismaOutsideAllowlistRule } from './no-unscoped-prisma-outside-allowlist';
import { prismaTxUsesTxNotClientRule } from './prisma-tx-uses-tx-not-client';
import { prismaWriteInTransactionRule } from './prisma-write-in-transaction';
import { tenantScopedTablesRequireWhereRule } from './tenant-scoped-tables-require-where';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-raw-sql-outside-allowlist': noRawSqlOutsideAllowlistRule,
  'no-unscoped-prisma-outside-allowlist': noUnscopedPrismaOutsideAllowlistRule,
  'prisma-tx-uses-tx-not-client': prismaTxUsesTxNotClientRule,
  'prisma-write-in-transaction': prismaWriteInTransactionRule,
  'tenant-scoped-tables-require-where': tenantScopedTablesRequireWhereRule,
};
