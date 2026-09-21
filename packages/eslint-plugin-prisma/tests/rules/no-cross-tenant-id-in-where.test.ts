import { ruleTester } from '@noctcore/eslint-test-utils';

import { noCrossTenantIdInWhereRule } from '../../src/rules/no-cross-tenant-id-in-where';

const TENANT = { tenantModels: ['invoice'] };

ruleTester.run('no-cross-tenant-id-in-where', noCrossTenantIdInWhereRule, {
  valid: [
    // tenantId from getTenantId() (trusted call).
    {
      code: `this.prisma.client.invoice.findMany({ where: { tenantId: getTenantId() } });`,
      options: [TENANT],
    },
    // tenantId from ctx.tenantId (trusted server context).
    {
      code: `this.prisma.client.invoice.findFirst({ where: { tenantId: ctx.tenantId } });`,
      options: [TENANT],
    },
    // tenantId from store.tenantId (trusted, deeper chain).
    {
      code: `tx.invoice.update({ where: { tenantId: store.scope.tenantId }, data: { name } });`,
      options: [TENANT],
    },
    // data block sourced from session.tenantId (trusted).
    {
      code: `this.prisma.client.invoice.create({ data: { tenantId: session.tenantId, name } });`,
      options: [TENANT],
    },
    // Not a tenant model: untrusted source on `user` is not policed by this rule.
    {
      code: `this.prisma.client.user.findMany({ where: { tenantId: input.tenantId } });`,
      options: [TENANT],
    },
    // Not a Prisma method on the tenant model.
    {
      code: `this.prisma.client.invoice.validate({ where: { tenantId: input.tenantId } });`,
      options: [TENANT],
    },
    // No where/data object -> nothing to inspect.
    {
      code: `this.prisma.client.invoice.findMany();`,
      options: [TENANT],
    },
    // where present but no tenantId field.
    {
      code: `this.prisma.client.invoice.findMany({ where: { name: input.name } });`,
      options: [TENANT],
    },
    // createManyAndReturn with a trusted tenant source: compliant.
    {
      code: `this.prisma.client.invoice.createManyAndReturn({ data: { tenantId: ctx.tenantId, name } });`,
      options: [TENANT],
    },
    // tenantId is a literal, not a client member chain.
    {
      code: `this.prisma.client.invoice.findMany({ where: { tenantId: 42 } });`,
      options: [TENANT],
    },
  ],
  invalid: [
    // Canonical IDOR: tenantId from input.tenantId in a where.
    {
      code: `this.prisma.client.invoice.findMany({ where: { tenantId: input.tenantId } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // dto.tenantId in a data block on a create.
    {
      code: `this.prisma.client.invoice.create({ data: { tenantId: dto.tenantId, name } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // Deeper untrusted chain: req.body.tenantId.
    {
      code: `tx.invoice.update({ where: { tenantId: req.body.tenantId }, data: { name } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // params root on a bare tenant-model receiver.
    {
      code: `invoice.deleteMany({ where: { tenantId: params.tenantId } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // body root, string-keyed properties still match.
    {
      code: `this.prisma.client.invoice.upsert({ where: { 'tenantId': body.tenantId } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // createManyAndReturn carries a `data` block like any other create, so an
    // attacker-supplied tenantId in it must report.
    {
      code: `this.prisma.client.invoice.createManyAndReturn({ data: { tenantId: input.tenantId, name } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // Same gap on the bulk-update half.
    {
      code: `this.prisma.client.invoice.updateManyAndReturn({ where: { tenantId: input.tenantId }, data: { name } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
    // The OrThrow reads take the same `where` and must report the same way.
    {
      code: `this.prisma.client.invoice.findFirstOrThrow({ where: { tenantId: query.tenantId } });`,
      options: [TENANT],
      errors: [{ messageId: 'untrustedTenantSource' }],
    },
  ],
});

ruleTester.run('no-cross-tenant-id-in-where (upstream options)', noCrossTenantIdInWhereRule, {
  valid: [
    {
      // untrustedRoots replaces the defaults.
      code: 'this.prisma.client.invoice.findMany({ where: { tenantId: input.tenantId } });',
      options: [{ untrustedRoots: ['payload'] }],
    },
    {
      // tenantField: a project whose discriminator is `orgId`.
      code: 'this.prisma.client.invoice.findMany({ where: { tenantId: input.tenantId } });',
      options: [{ tenantField: 'orgId' }],
    },
    {
      // An explicit empty list polices nothing.
      code: 'this.prisma.client.invoice.findMany({ where: { tenantId: input.tenantId } });',
      options: [{ tenantModels: [] }],
    },
  ],
  invalid: [
    {
      // With tenantModels omitted every model is policed: a client-supplied
      // tenant id is an IDOR whichever table it filters.
      code: 'this.prisma.client.user.findMany({ where: { tenantId: input.tenantId } });',
      errors: [{ messageId: 'untrustedTenantSource', data: { field: 'tenantId', root: 'input' } }],
    },
    {
      code: 'tx.project.update({ where: { id }, data: { orgId: payload.org.id } });',
      options: [{ tenantField: 'orgId', untrustedRoots: ['payload'] }],
      errors: [{ messageId: 'untrustedTenantSource', data: { field: 'orgId', root: 'payload' } }],
    },
  ],
});
