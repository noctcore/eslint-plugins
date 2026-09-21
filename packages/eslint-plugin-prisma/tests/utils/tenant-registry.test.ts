import { describe, expect, it } from 'vitest';

import { parsePrismaSchema, tenantBearingAccessors } from '../../src/utils/prisma-schema';
import { reconcileTenantRegistry } from '../../src/utils/tenant-registry';

/*
 * The registry-vs-schema gate, at the unit level.
 *
 * A consumer runs this against its real schema and its real extension map.
 * Here it runs against a fixture that spells out the case that matters: a
 * migration lands a tenant-bearing table and nobody edits either
 * hand-maintained registry.
 */

const FIXTURE_SCHEMA = `
model Project {
  id       String @id
  tenantId String
  name     String
}

model Invoice {
  id       String @id
  tenantId String
  total    Int
}

model AuditLog {
  id       String  @id
  tenantId String?
  action   String
}

model Tenant {
  id   String @id
  name String
}
`;

const parsed = parsePrismaSchema(FIXTURE_SCHEMA);

const reconcile = (
  scopedModels: readonly string[],
  unscopedByDesign: Readonly<Record<string, string>> = {},
) =>
  reconcileTenantRegistry({
    parsed,
    tenantFields: ['tenantId'],
    scopedModels,
    unscopedByDesign,
  });

describe('parsePrismaSchema field capture', () => {
  it('records the field names of every model', () => {
    expect([...(parsed.fieldsByModel.get('Invoice') ?? [])]).toEqual(['id', 'tenantId', 'total']);
    expect([...(parsed.fieldsByModel.get('Tenant') ?? [])]).toEqual(['id', 'name']);
  });

  it('derives the tenant-bearing models as delegate accessors', () => {
    // Nullable columns count: `tenantId String?` is still a tenant column.
    expect(tenantBearingAccessors(parsed, ['tenantId'])).toEqual(['auditLog', 'invoice', 'project']);
    expect(tenantBearingAccessors(parsed, ['tenantId', 'regionId'])).toEqual([]);
  });
});

describe('reconcileTenantRegistry', () => {
  it('is silent when every tenant-bearing model is scoped or exempt', () => {
    const result = reconcile(['project', 'invoice'], { auditLog: 'pre-auth writes have no tenant' });
    expect(result.messages).toEqual([]);
    expect(result.schemaModels).toEqual(['auditLog', 'invoice', 'project']);
  });

  it('fails on a tenant-bearing model that is in neither registry', () => {
    // THE case: a migration adds `Invoice`, both hand lists still agree with
    // each other, and the new table has no boundary at all.
    const result = reconcile(['project'], { auditLog: 'pre-auth writes have no tenant' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('`invoice` carries tenantId');
    expect(result.messages[0]).toContain('no tenant boundary at all');
  });

  it('rejects an exemption that contradicts the extension', () => {
    const result = reconcile(['project', 'invoice'], {
      auditLog: 'pre-auth writes have no tenant',
      invoice: 'this reason is a lie, the extension scopes it',
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('BOTH isolated');
  });

  it('reports a stale exemption for a model that no longer bears the column', () => {
    const result = reconcile(['project', 'invoice'], {
      auditLog: 'pre-auth writes have no tenant',
      receipt: 'a table that was renamed away',
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('`receipt` is listed as unscoped by design');
  });

  it('reports a scoped model the schema has no tenant column for', () => {
    // A scope filter on a column that does not exist can never match, so the
    // extension would be isolating nothing while looking like it isolates.
    const result = reconcile(['project', 'invoice', 'tenant'], {
      auditLog: 'pre-auth writes have no tenant',
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain('`tenant` is isolated by the tenant-scope extension');
  });
});
