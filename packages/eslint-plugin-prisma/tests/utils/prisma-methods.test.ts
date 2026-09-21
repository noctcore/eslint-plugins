import { describe, expect, it } from 'vitest';

import {
  PRISMA_CREATE_METHODS,
  PRISMA_DELEGATE_METHODS,
  PRISMA_DELETE_METHODS,
  PRISMA_FILTERED_WRITE_METHODS,
  PRISMA_READ_METHODS,
  PRISMA_SCOPED_READ_METHODS,
  PRISMA_UNIQUE_READ_METHODS,
  PRISMA_UPDATE_METHODS,
  PRISMA_WRITE_METHODS,
} from '../../src/utils/prisma-methods';

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('prisma method sets', () => {
  it('is the Prisma model-delegate surface', () => {
    // Pinned so a change to the surface is a deliberate, reviewed edit.
    expect(sorted(PRISMA_DELEGATE_METHODS)).toEqual([
      'aggregate',
      'count',
      'create',
      'createMany',
      'createManyAndReturn',
      'delete',
      'deleteMany',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'findUnique',
      'findUniqueOrThrow',
      'groupBy',
      'update',
      'updateMany',
      'updateManyAndReturn',
      'upsert',
    ]);
  });

  it('the sets partition the surface with no overlap and no gap', () => {
    expect(sorted(PRISMA_WRITE_METHODS)).toEqual(
      sorted([...PRISMA_CREATE_METHODS, ...PRISMA_UPDATE_METHODS, ...PRISMA_DELETE_METHODS]),
    );
    expect(sorted(PRISMA_READ_METHODS)).toEqual(
      sorted([...PRISMA_SCOPED_READ_METHODS, ...PRISMA_UNIQUE_READ_METHODS]),
    );
    expect(new Set(PRISMA_DELEGATE_METHODS).size).toBe(PRISMA_DELEGATE_METHODS.length);

    const writes = new Set(PRISMA_WRITE_METHODS);
    for (const method of PRISMA_READ_METHODS) {
      expect(writes.has(method), `${method} is listed as both a read and a write`).toBe(false);
    }
  });

  it('the filtered writes are writes that take an arbitrary where clause', () => {
    // `update` / `delete` / `upsert` take a unique selector, so a rule that
    // demanded a tenant column in their `where` would be pure noise.
    const writes = new Set(PRISMA_WRITE_METHODS);
    for (const method of PRISMA_FILTERED_WRITE_METHODS) {
      expect(writes.has(method), `${method} must be a write`).toBe(true);
    }
    expect(sorted(PRISMA_FILTERED_WRITE_METHODS)).toEqual([
      'deleteMany',
      'updateMany',
      'updateManyAndReturn',
    ]);
  });

  it('the *AndReturn writes are covered', () => {
    expect(PRISMA_CREATE_METHODS).toContain('createManyAndReturn');
    expect(PRISMA_UPDATE_METHODS).toContain('updateManyAndReturn');
  });
});
