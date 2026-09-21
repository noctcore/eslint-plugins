import { noCrossTenantIdInWhereRule } from './no-cross-tenant-id-in-where';
import { noRawSqlOutsideAllowlistRule } from './no-raw-sql-outside-allowlist';
import { noUnscopedPrismaOutsideAllowlistRule } from './no-unscoped-prisma-outside-allowlist';
import { prismaTxUsesTxNotClientRule } from './prisma-tx-uses-tx-not-client';
import { prismaWriteInTransactionRule } from './prisma-write-in-transaction';
import { softDeletableTablesRequireDeletedAtRule } from './soft-deletable-tables-require-deleted-at';
import { tenantScopedTablesRequireWhereRule } from './tenant-scoped-tables-require-where';
import { tenantWriteMustCarryTenantIdRule } from './tenant-write-must-carry-tenant-id';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-cross-tenant-id-in-where': noCrossTenantIdInWhereRule,
  'no-raw-sql-outside-allowlist': noRawSqlOutsideAllowlistRule,
  'no-unscoped-prisma-outside-allowlist': noUnscopedPrismaOutsideAllowlistRule,
  'prisma-tx-uses-tx-not-client': prismaTxUsesTxNotClientRule,
  'prisma-write-in-transaction': prismaWriteInTransactionRule,
  'soft-deletable-tables-require-deleted-at': softDeletableTablesRequireDeletedAtRule,
  'tenant-scoped-tables-require-where': tenantScopedTablesRequireWhereRule,
  'tenant-write-must-carry-tenant-id': tenantWriteMustCarryTenantIdRule,
};
