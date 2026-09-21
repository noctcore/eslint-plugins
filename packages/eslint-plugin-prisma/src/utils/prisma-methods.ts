/**
 * The one place this plugin spells Prisma's model-delegate method surface.
 *
 * Every rule that guards Prisma calls by method name derives its set from the
 * lists below. A per-rule `new Set([...])` is how such rules drift apart: a
 * fence that lists `createManyAndReturn` next to a transaction rule that does
 * not means `db.invoice.createManyAndReturn({ data: [...] })` lints clean in
 * exactly the place the other rule was written to catch.
 *
 * A method Prisma adds is added here once and reaches every rule.
 * `tests/utils/prisma-methods.test.ts` asserts the sets partition the surface
 * with no overlap and no gap. A consumer that ships a generated client can go
 * further and assert `PRISMA_DELEGATE_METHODS` against its `<Model>Delegate`
 * interface, which turns a Prisma upgrade that adds a method red instead of
 * silently opening a hole.
 */

/**
 * Writes that insert rows.
 *
 * `createManyAndReturn` is an ordinary create that also returns the inserted
 * rows; it reads like normal code rather than like evasion, which is exactly
 * why leaving it out of a guarded set is dangerous.
 */
export const PRISMA_CREATE_METHODS: readonly string[] = [
  'create',
  'createMany',
  'createManyAndReturn',
];

/** Writes that mutate existing rows (or insert when absent, for `upsert`). */
export const PRISMA_UPDATE_METHODS: readonly string[] = [
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
];

/** Writes that remove rows outright, payload or not. */
export const PRISMA_DELETE_METHODS: readonly string[] = ['delete', 'deleteMany'];

/** Every write: create + update + delete. */
export const PRISMA_WRITE_METHODS: readonly string[] = [
  ...PRISMA_CREATE_METHODS,
  ...PRISMA_UPDATE_METHODS,
  ...PRISMA_DELETE_METHODS,
];

/**
 * Writes whose first argument carries an arbitrary `where` FILTER rather than a
 * unique selector, so a tenant column can and must be pinned in it.
 *
 * `update` / `delete` / `upsert` take a unique selector instead and are absent
 * on purpose: a rule demanding `tenantId` in a `where: { id }` would be noise.
 */
export const PRISMA_FILTERED_WRITE_METHODS: readonly string[] = [
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
];

/**
 * Reads whose first argument carries an arbitrary `where` filter, plus the
 * aggregates that accept the same filter shape. These are the reads a
 * tenant-scope rule can demand a discriminator from.
 */
export const PRISMA_SCOPED_READ_METHODS: readonly string[] = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
];

/** Reads that take a unique selector, not a filter. */
export const PRISMA_UNIQUE_READ_METHODS: readonly string[] = ['findUnique', 'findUniqueOrThrow'];

/** Every read: filtered + unique. */
export const PRISMA_READ_METHODS: readonly string[] = [
  ...PRISMA_SCOPED_READ_METHODS,
  ...PRISMA_UNIQUE_READ_METHODS,
];

/** Prisma's complete model-delegate method surface: every read and every write. */
export const PRISMA_DELEGATE_METHODS: readonly string[] = [
  ...PRISMA_WRITE_METHODS,
  ...PRISMA_READ_METHODS,
];
