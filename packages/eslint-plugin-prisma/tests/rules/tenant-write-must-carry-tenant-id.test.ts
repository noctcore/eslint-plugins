import { ruleTester } from '@noctcore/eslint-test-utils';

import { tenantWriteMustCarryTenantIdRule } from '../../src/rules/tenant-write-must-carry-tenant-id';

const TENANT = { tenantModels: ['invoice'] };

ruleTester.run('tenant-write-must-carry-tenant-id', tenantWriteMustCarryTenantIdRule, {
  valid: [
    // Unscoped create with tenantId shorthand in data: compliant.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name, tenantId } });',
      options: [TENANT],
    },
    // Unscoped create with explicit tenantId value from a trusted source.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name, tenantId: ctx.tenantId } });',
      options: [TENANT],
    },
    // Extended (request-path) client auto-injects tenantId on create: exempt.
    {
      code: 'this.prisma.client.invoice.create({ data: { name } });',
      options: [TENANT],
    },
    // Extended client createMany: exempt (no `unscoped` in chain).
    {
      code: "tx.invoice.createMany({ data: [{ name: 'a' }] });",
      options: [TENANT],
    },
    // Non-tenant model on the unscoped client: not policed.
    {
      code: "this.prisma.unscoped.user.create({ data: { email: 'x' } });",
    },
    // Spread inside data: cannot statically verify, allowed.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { ...dto } });',
      options: [TENANT],
    },
    // data is an identifier (not an object literal): unverifiable, allowed.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: payload });',
      options: [TENANT],
    },
    // createManyAndReturn carrying tenantId on every element: compliant.
    {
      code: "this.prisma.unscoped.invoice.createManyAndReturn({ data: [{ name: 'a', tenantId }] });",
      options: [TENANT],
    },
    // createMany with array elements all carrying tenantId: compliant.
    {
      code: "this.prisma.unscoped.invoice.createMany({ data: [{ name: 'a', tenantId }, { name: 'b', tenantId }] });",
      options: [TENANT],
    },
    // createMany element with a spread: unverifiable element, allowed.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: [{ ...row }] });',
      options: [TENANT],
    },
    // createMany via .map concise arrow returning object with tenantId.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: rows.map((r) => ({ name: r.name, tenantId })) });',
      options: [TENANT],
    },
    // createMany via .map block body returning object with tenantId.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: rows.map((r) => { return { name: r.name, tenantId }; }) });',
      options: [TENANT],
    },
    // createMany .map where returned object cannot be cleanly extracted: allowed.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: rows.map(buildRow) });',
      options: [TENANT],
    },
    // Computed member access on the model does not match the heuristic shape.
    {
      code: "this.prisma.unscoped['invoice'].create({ data: { name: 'x' } });",
    },
    // create with no arguments at all: unverifiable, allowed.
    {
      code: 'this.prisma.unscoped.invoice.create();',
      options: [TENANT],
    },
    // Configured custom field present in data: respects the option.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name, accountId } });',
      options: [{ tenantModels: ['invoice'], tenantFields: ['accountId'] }],
    },
    // Multi-axis scope: data carrying BOTH configured fields is compliant.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name, tenantId, accountId } });',
      options: [{ tenantModels: ['invoice'], tenantFields: ['tenantId', 'accountId'] }],
    },
    // Resolved binding whose data carries tenantId: compliant (not flagged).
    {
      code: 'const { unscoped } = this.prismaService; unscoped.invoice.create({ data: { name, tenantId } });',
      options: [TENANT],
    },
  ],
  invalid: [
    // Spec INVALID: unscoped create on tenant model, data lacks tenantId.
    {
      code: "this.prisma.unscoped.invoice.create({ data: { name: 'x' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // Unscoped create with data lacking tenantId (shorthand other key).
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name } });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // createManyAndReturn: an ordinary bulk create that also returns the rows.
    // Omitting it from the method set is a clean bypass on the one client that
    // gets no $extends scope injection, so the set is shared with the
    // single-writer fences.
    {
      code: "this.prisma.unscoped.invoice.createManyAndReturn({ data: [{ name: 'a' }] });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // createMany array where one element lacks tenantId.
    {
      code: "this.prisma.unscoped.invoice.createMany({ data: [{ name: 'a', tenantId }, { name: 'b' }] });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // createMany via .map concise arrow returning object without tenantId.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: rows.map((r) => ({ name: r.name })) });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // createMany via .map block body returning object without tenantId.
    {
      code: 'this.prisma.unscoped.invoice.createMany({ data: rows.map((r) => { return { name: r.name }; }) });',
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // Configured custom field absent from data.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name } });',
      options: [{ tenantModels: ['invoice'], tenantFields: ['accountId'] }],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // Multi-axis scope: data carrying only tenantId is incomplete when both
    // tenantId AND accountId are required.
    {
      code: 'this.prisma.unscoped.invoice.create({ data: { name, tenantId } });',
      options: [{ tenantModels: ['invoice'], tenantFields: ['tenantId', 'accountId'] }],
      errors: [{ messageId: 'missingTenantId' }],
    },
    // Evasion via destructured binding: a create through `const { unscoped }`
    // missing tenantId is now resolved and flagged.
    {
      code: "const { unscoped } = this.prismaService; unscoped.invoice.create({ data: { name: 'x' } });",
      options: [TENANT],
      errors: [{ messageId: 'missingTenantId' }],
    },
  ],
});

ruleTester.run('tenant-write-must-carry-tenant-id (upstream options)', tenantWriteMustCarryTenantIdRule, {
  valid: [
    {
      // No tenantModels by default: nothing is guessed.
      code: "this.prisma.unscoped.invoice.create({ data: { name: 'x' } });",
    },
    {
      // unscopedProperty: renamed, so `.unscoped` is just a property.
      code: "this.prisma.unscoped.invoice.create({ data: { name: 'x' } });",
      options: [{ ...TENANT, unscopedProperty: 'raw' }],
    },
  ],
  invalid: [
    {
      code: "const { raw } = this.db; raw.invoice.create({ data: { name: 'x', tenantId } });",
      options: [
        { ...TENANT, tenantFields: ['tenantId', 'accountId'], receiverPattern: '^db$', unscopedProperty: 'raw' },
      ],
      errors: [
        { messageId: 'missingTenantId', data: { model: 'invoice', fields: 'tenantId and accountId' } },
      ],
    },
  ],
});
