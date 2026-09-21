import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { guardedRelationNames, relationNamesFor } from '../../src/utils/prisma-nested-write';
import {
  DEFAULT_SCHEMA_PATH,
  delegateAccessor,
  loadPrismaSchema,
  parsePrismaSchema,
  relationFieldsForModels,
  resolveSchemaPath,
} from '../../src/utils/prisma-schema';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const FIXTURE_SCHEMA = path.join(FIXTURES, 'billing-schema.prisma');
const SCHEMA_FOLDER = path.join(FIXTURES, 'schema-folder');
const LINTED_FILE = path.join(FIXTURES, 'src', 'billing.service.ts');

/** Independent of the parser on purpose: a dumb regex over the raw text. */
function modelNamesByRegex(source: string): string[] {
  return [...source.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)].map((match) => match[1] ?? '');
}

describe('parsePrismaSchema', () => {
  const source = readFileSync(FIXTURE_SCHEMA, 'utf8');
  const parsed = parsePrismaSchema(source);

  it('finds exactly the models a dumb regex finds', () => {
    expect(parsed.models).toEqual(modelNamesByRegex(source));
  });

  it('never treats an enum-typed field or a block attribute as a relation', () => {
    expect(parsed.relationFields.some((relation) => relation.field === 'status')).toBe(false);
    expect([...(parsed.fieldsByModel.get('Account') ?? [])]).not.toContain('@@index');
  });

  it('derives every relation field pointing at the guarded models', () => {
    const derived = relationFieldsForModels(parsed, ['invoice', 'payment']);
    expect([...derived].sort()).toEqual([
      'invoice',
      'invoices',
      'issuedInvoices',
      'payments',
      'supersededBy',
      'supersedes',
    ]);
  });

  it('never derives a relation pointing at an unguarded model', () => {
    const derived = relationFieldsForModels(parsed, ['invoice', 'payment']);
    expect(derived.has('customers')).toBe(false);
    expect(derived.has('notes')).toBe(false);
    expect(derived.has('account')).toBe(false);
  });

  it('maps a model name to its Prisma delegate accessor', () => {
    expect(delegateAccessor('InvoiceLine')).toBe('invoiceLine');
    expect(delegateAccessor('')).toBe('');
  });
});

describe('loadPrismaSchema', () => {
  it('reads a whole schema folder so cross-file relations resolve', () => {
    // `Order.lines` points at a model declared in a different file.
    const parsed = loadPrismaSchema(SCHEMA_FOLDER);
    expect(parsed?.models).toEqual(['Order', 'OrderLine']);
    expect([...relationFieldsForModels(parsed ?? parsePrismaSchema(''), ['orderLine'])]).toEqual([
      'lines',
    ]);
  });

  it('fails quiet on a missing schema', () => {
    expect(loadPrismaSchema(path.join(FIXTURES, 'does-not-exist.prisma'))).toBeNull();
  });

  it('serves a cached parse for an unchanged file', () => {
    expect(loadPrismaSchema(FIXTURE_SCHEMA)).toBe(loadPrismaSchema(FIXTURE_SCHEMA));
  });
});

describe('resolveSchemaPath', () => {
  it("defaults to Prisma's own location", () => {
    expect(DEFAULT_SCHEMA_PATH).toBe('prisma/schema.prisma');
  });

  it('resolves a relative path against the workspace root and keeps an absolute one', () => {
    const repoRoot = path.resolve(FIXTURES, '..', '..', '..', '..');
    expect(resolveSchemaPath(LINTED_FILE, 'prisma/schema.prisma')).toBe(
      path.join(repoRoot, 'prisma/schema.prisma'),
    );
    expect(resolveSchemaPath(LINTED_FILE, FIXTURE_SCHEMA)).toBe(FIXTURE_SCHEMA);
  });
});

describe('guardedRelationNames', () => {
  it('falls back to the name-shaped floor when no schema is in reach', () => {
    const names = guardedRelationNames({
      filename: LINTED_FILE,
      schemaPath: path.join(FIXTURES, 'does-not-exist.prisma'),
      guardedModels: ['category'],
      extraRelations: ['cats'],
    });
    expect([...names].sort()).toEqual(['categories', 'category', 'cats']);
  });

  it('unions the derived names with the floor and the configured extras', () => {
    const names = guardedRelationNames({
      filename: LINTED_FILE,
      schemaPath: FIXTURE_SCHEMA,
      guardedModels: ['invoice'],
      extraRelations: ['legacyInvoices'],
    });
    expect(names.has('issuedInvoices')).toBe(true);
    expect(names.has('supersededBy')).toBe(true);
    expect(names.has('legacyInvoices')).toBe(true);
    expect(names.has('invoice')).toBe(true);
  });

  it('builds the floor from model names alone', () => {
    expect([...relationNamesFor(['invoice'])].sort()).toEqual(['invoice', 'invoices']);
  });
});
