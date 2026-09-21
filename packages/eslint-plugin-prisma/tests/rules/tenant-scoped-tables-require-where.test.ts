import { ruleTester } from '@noctcore/eslint-test-utils';

import { tenantScopedTablesRequireWhereRule } from '../../src/rules/tenant-scoped-tables-require-where';

const TENANT = { tenantModels: ['invoice'] };

const HAND_SCOPED = {
  handScopedModels: { auditLog: ['tenantId'], notification: ['userId', 'jobId'] },
};

ruleTester.run('tenant-scoped-tables-require-where', tenantScopedTablesRequireWhereRule, {
  valid: [
    // hand-scoped: the extended client still has to carry the scope, and
    // a flat where mentioning it is enough.
    {
      code: 'this.client.notification.findMany({ where: { userId } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: hand-scoped on a `tx` receiver: same requirement, same answer.
    {
      code: 'tx.auditLog.findMany({ where: { tenantId, action } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: hand-scoped through the unscoped client: also policed, also fine.
    {
      code: 'this.prisma.unscoped.auditLog.count({ where: { tenantId } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: the audit feed's real shape: the scope sits inside an AND array and
    // an OR arm, one of which reaches it through a relation.
    {
      code: 'this.client.auditLog.findMany({ where: { AND: [{ OR: [{ tenantId }, { tenantId: null, user: { tenantId } }] }, ...clauses] } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: any ONE of the listed columns is enough: the worker's retry lookup
    // keys on the unique job id, before a user is in hand.
    {
      code: 'this.client.notification.findUnique({ where: { jobId } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: a hand-scoped model is not policed when it is not configured, so the
    // option is what turns this on and nothing is guessed.
    {
      code: 'this.client.auditLog.findMany({ where: { targetId } });',
    },
    // hand-scoped: a write with no `where` at all (create) is not this rule's business.
    {
      code: 'this.client.auditLog.create({ data: { action } });',
      options: [HAND_SCOPED],
    },
    // hand-scoped: allowIn covers the hand-scoped half too: the retention sweeps read
    // every tenant's expired rows on purpose.
    {
      code: 'this.client.auditLog.findMany({ where: { createdAt: { lt: cutoff } } });',
      filename: 'apps/api/src/modules/audit/audit-retention.service.ts',
      options: [{ ...TENANT, ...HAND_SCOPED, allowIn: ['**/modules/audit/audit-retention.service.ts'] }],
    },
    // Unscoped client with tenantId shorthand in where: compliant.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { tenantId } });',
      options: [TENANT],
    },
    // Unscoped client with explicit tenantId value in where: compliant.
    {
      code: 'this.prisma.unscoped.invoice.findFirst({ where: { tenantId: ctx.tenantId, name } });',
      options: [TENANT],
    },
    // Extended (request-path) client auto-injects tenantId: exempt.
    {
      code: 'this.prisma.client.invoice.findMany({});',
      options: [TENANT],
    },
    // Extended client with no args at all: exempt (no `unscoped` in chain).
    {
      code: 'this.prisma.client.invoice.deleteMany();',
      options: [TENANT],
    },
    // Non-tenant model on the unscoped client: not policed.
    {
      code: "this.prisma.unscoped.user.findMany({ where: { email: 'x' } });",
    },
    // findUnique is exempt even on the unscoped client.
    {
      code: 'this.prisma.unscoped.invoice.findUnique({ where: { id } });',
      options: [TENANT],
    },
    // create is not in the guarded read/bulk-mutation set.
    {
      code: "this.prisma.unscoped.invoice.create({ data: { name: 'x' } });",
      options: [TENANT],
    },
    // Computed member access does not match the heuristic shape.
    {
      code: "this.prisma.unscoped['invoice'].findMany({ where: { name: 'x' } });",
    },
    // updateManyAndReturn pinned to the tenant: compliant.
    {
      code: 'this.prisma.unscoped.invoice.updateManyAndReturn({ where: { tenantId, status }, data: { status } });',
      options: [TENANT],
    },
    // tenantId nested inside `where` object literal.
    {
      code: 'tx.unscoped.invoice.updateMany({ where: { tenantId, status }, data: { status } });',
      options: [TENANT],
    },
    // Custom tenantFields option: the configured key satisfies the rule.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { accountId } });',
      options: [{ ...TENANT, tenantFields: ['accountId'] }],
    },
    // Multi-axis scope: where carrying BOTH configured fields is compliant.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { tenantId, accountId } });',
      options: [{ ...TENANT, tenantFields: ['tenantId', 'accountId'] }],
    },
    // findUniqueOrThrow is exempt (unique selector, like findUnique).
    {
      code: 'this.prisma.unscoped.invoice.findUniqueOrThrow({ where: { id } });',
      options: [TENANT],
    },
    // Resolved binding that carries tenantId: compliant (not flagged).
    {
      code: 'const { unscoped } = this.prismaService; unscoped.invoice.findMany({ where: { tenantId } });',
      options: [TENANT],
    },
    // allowIn: a cross-tenant system sweep in an exempted file is not policed.
    // This is the shape the option exists for -- a scheduler pass that reads
    // EVERY tenant's rows on purpose and so cannot carry one tenantId.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { required: true } });',
      filename: 'apps/api/src/modules/auth/sweep/sweep.processor.ts',
      options: [{ ...TENANT, allowIn: ['**/modules/auth/sweep/sweep.processor.ts'] }],
    },
    // allowIn glob matches a directory: everything under it is exempt.
    {
      code: 'this.prisma.unscoped.invoice.deleteMany();',
      filename: 'apps/api/src/modules/auth/sweep/nested/other.processor.ts',
      options: [{ ...TENANT, allowIn: ['**/modules/auth/sweep/**'] }],
    },
  ],
  invalid: [
    // hand-scoped: the defect boringstack shipped: a history panel filtered by its
    // target alone, returning every tenant's rows.
    {
      code: 'this.client.auditLog.findMany({ where: { targetType: "Employee", targetId } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: the extended client is NOT a defence here: the extension passes
    // AuditLog through untouched.
    {
      code: 'this.client.auditLog.findFirst({ where: { id } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: same on a transaction client.
    {
      code: 'tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: same on the unscoped client.
    {
      code: 'this.prisma.unscoped.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: a unique selector is no safer for a hand-scoped model: this is the
    // IDOR, one user reading another user's row by id.
    {
      code: 'this.client.notification.findUnique({ where: { id } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: a singular update by id, which the extension-scoped half exempts.
    {
      code: 'this.client.notification.update({ where: { id }, data: { readAt } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: no `where` at all reads the whole table.
    {
      code: 'this.client.auditLog.findMany({ orderBy: { createdAt: "desc" } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: the scope lifted into a local const is invisible to a syntactic
    // rule, so it is reported: the clause has to be spelled at the call site.
    {
      code: 'const visibility = { tenantId }; this.client.auditLog.findMany({ where: { AND: [visibility] } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // hand-scoped: a column that merely LOOKS like a scope does not count.
    {
      code: 'this.client.notification.findMany({ where: { actorUserId } });',
      options: [HAND_SCOPED],
      errors: [{ messageId: 'missingHandScopedWhere' }],
    },
    // updateManyAndReturn is an ordinary filtered bulk update that also returns
    // the rows, so an unscoped one is a cross-tenant sweep like updateMany.
    {
      code: 'this.prisma.unscoped.invoice.updateManyAndReturn({ where: { status }, data: { status } });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Unscoped read on tenant model, where lacks tenantId.
    {
      code: "this.prisma.unscoped.invoice.findMany({ where: { name: 'x' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Unscoped findFirst with no where at all.
    {
      code: 'this.prisma.unscoped.invoice.findFirst({});',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Unscoped deleteMany with no arguments.
    {
      code: 'this.prisma.unscoped.invoice.deleteMany();',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Unscoped updateMany whose where carries the wrong key.
    {
      code: 'this.prisma.unscoped.invoice.updateMany({ where: { id }, data: { status } });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Unscoped count without tenantId.
    {
      code: "this.prisma.unscoped.invoice.count({ where: { status: 'active' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Tenant field absent under the default tenantField.
    {
      code: "tx.unscoped.invoice.aggregate({ where: { kind: 'a' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Custom tenantFields option: with ['accountId'], a where carrying only the
    // default 'tenantId' does not satisfy the requirement.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { tenantId } });',
      options: [{ ...TENANT, tenantFields: ['accountId'] }],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Multi-axis scope: a where carrying only tenantId is incomplete when both
    // tenantId AND accountId are required (the copy-the-block leak the parameterised
    // extension is designed to prevent).
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { tenantId } });',
      options: [{ ...TENANT, tenantFields: ['tenantId', 'accountId'] }],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Evasion via destructured binding: `const { unscoped } = svc` then a
    // tenant-model read missing tenantId is now resolved and flagged.
    {
      code: "const { unscoped } = this.prismaService; unscoped.invoice.findMany({ where: { name: 'x' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // Evasion via single-hop alias: `const db = this.prisma.unscoped` then a
    // tenant-model read missing tenantId.
    {
      code: "const db = this.prisma.unscoped; db.invoice.count({ where: { status: 'a' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // L2: findFirstOrThrow is now guarded (it reads across tenants on the
    // unscoped client just like findFirst).
    {
      code: 'this.prisma.unscoped.invoice.findFirstOrThrow({ where: { id } });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // L2: groupBy is now guarded (an unscoped aggregate spans every tenant).
    {
      code: "this.prisma.unscoped.invoice.groupBy({ by: ['status'] });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // allowIn is per-file, not per-rule: a file OUTSIDE the exempted glob is
    // still policed while the option is set.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { required: true } });',
      filename: 'apps/api/src/modules/auth/other/other.service.ts',
      options: [{ ...TENANT, allowIn: ['**/modules/auth/sweep/sweep.processor.ts'] }],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
    // An empty allowIn exempts nothing (the default), so the guard still bites.
    {
      code: 'this.prisma.unscoped.invoice.findMany({ where: { required: true } });',
      filename: 'apps/api/src/modules/auth/sweep/sweep.processor.ts',
      options: [{ ...TENANT, allowIn: [] }],
      errors: [{ messageId: 'missingTenantWhere' }],
    },
  ],
});

ruleTester.run('tenant-scoped-tables-require-where (upstream options)', tenantScopedTablesRequireWhereRule, {
  valid: [
    {
      // No tenantModels by default: nothing is guessed, so an unscoped read of
      // any model is left to the project's registry.
      code: 'this.prisma.unscoped.invoice.findMany({ where: { name } });',
    },
    {
      // unscopedProperty: renamed, so `.unscoped` is just a property.
      code: 'this.prisma.unscoped.invoice.findMany({ where: { name } });',
      options: [{ tenantModels: ['invoice'], unscopedProperty: 'raw' }],
    },
    {
      // A hand-scoped model key inherited from Object.prototype is not configured.
      code: 'this.client.constructor.findMany({ where: { name } });',
      options: [{ handScopedModels: { auditLog: ['tenantId'] } }],
    },
  ],
  invalid: [
    {
      code: 'this.db.raw.invoice.findMany({ where: { name } });',
      options: [{ tenantModels: ['invoice'], receiverPattern: '^db$', unscopedProperty: 'raw' }],
      errors: [{ messageId: 'missingTenantWhere', data: { model: 'invoice', fields: 'tenantId' } }],
    },
    {
      code: 'const { raw } = this.db; raw.invoice.count({ where: { tenantId } });',
      options: [
        {
          tenantModels: ['invoice'],
          tenantFields: ['tenantId', 'accountId'],
          receiverPattern: '^db$',
          unscopedProperty: 'raw',
        },
      ],
      errors: [
        { messageId: 'missingTenantWhere', data: { model: 'invoice', fields: 'tenantId and accountId' } },
      ],
    },
  ],
});
