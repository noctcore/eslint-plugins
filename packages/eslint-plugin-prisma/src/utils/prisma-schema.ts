import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { findRepoRoot } from './allowlist';

/**
 * Reads a Prisma schema so a rule can learn the relation fields that reach a
 * guarded model, instead of guessing them from its name.
 *
 * Guessing leaks. A fence keyed on `<model>` and `<model>s` catches
 * `customer.invoices` and nothing else, while a real schema reaches the same
 * model through differently-named fields: `issuedInvoices`, `supersededBy`,
 * `corrects`, `parent`. A nested write through any of them
 * (`account.update({ data: { issuedInvoices: { updateMany: ... } } })`) lints
 * clean under the guess.
 *
 * A hand-maintained list would close that hole exactly once, until the next
 * relation is added. Deriving from the schema closes it permanently: a relation
 * added tomorrow is guarded the moment the migration lands, with no rule edit.
 *
 * The parse is deliberately small. It reads `model X { ... }` blocks and, in
 * each, the fields and their types. It does not understand attributes, enums,
 * generators or datasources, and it does not need to: an enum-typed field can
 * never equal a model name, so it cannot match. What the parser CAN do is
 * quietly rot if the schema language changes under it, which is why a consumer
 * should keep a test that re-derives the model list from its real schema with
 * an independent regex and fails when the two disagree.
 */

/**
 * Default schema location, relative to the workspace root: Prisma's own
 * default. A DIRECTORY works too (the `prismaSchemaFolder` layout): every
 * `.prisma` inside it is read and concatenated, because a relation's target may
 * be declared in a different file than the field pointing at it.
 */
export const DEFAULT_SCHEMA_PATH = 'prisma/schema.prisma';

export interface PrismaRelationField {
  /** The model declaring the field, e.g. `Customer`. */
  readonly owner: string;
  /** The field name, which is the key a nested write uses, e.g. `invoices`. */
  readonly field: string;
  /** The Prisma delegate accessor of the field's type, e.g. `invoice`. */
  readonly targetAccessor: string;
}

export interface ParsedPrismaSchema {
  /** Every `model X` declared, in declaration order. */
  readonly models: readonly string[];
  /** Every field whose type is one of those models. */
  readonly relationFields: readonly PrismaRelationField[];
  /**
   * Field names declared by each model, keyed by model name.
   *
   * Scalars as well as relations: a tenant boundary is a COLUMN (`tenantId`),
   * so a registry check that only saw relations could not tell a
   * tenant-bearing table from any other.
   */
  readonly fieldsByModel: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Prisma's delegate accessor for a model: the name with a lowercased initial. */
export function delegateAccessor(model: string): string {
  return model.length === 0 ? model : `${model[0]?.toLowerCase() ?? ''}${model.slice(1)}`;
}

/** Strip list and optional markers from a field type: `Invoice[]?` -> `Invoice`. */
function baseTypeName(raw: string): string {
  return raw.replace(/\[\]/g, '').replace(/\?/g, '');
}

/**
 * Parse a schema into its models and the fields that point at them.
 *
 * Line-oriented on purpose: a field declaration in Prisma is always
 * `<name> <Type> [attributes...]` on one line, so a scanner needs no grammar,
 * and anything it cannot classify it simply ignores.
 */
export function parsePrismaSchema(source: string): ParsedPrismaSchema {
  const models: string[] = [];
  const candidates: { owner: string; field: string; type: string }[] = [];
  const fieldsByModel = new Map<string, Set<string>>();

  let currentModel: string | null = null;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('//')) continue;

    if (currentModel === null) {
      const opened = /^model\s+([A-Za-z_]\w*)\s*\{/.exec(line);
      if (opened?.[1] !== undefined) {
        currentModel = opened[1];
        models.push(currentModel);
        // A model split across two blocks would otherwise lose the first half.
        if (!fieldsByModel.has(currentModel)) fieldsByModel.set(currentModel, new Set());
      }
      continue;
    }

    if (line.startsWith('}')) {
      currentModel = null;
      continue;
    }

    // Block-level attributes (`@@index`, `@@unique`) are not fields.
    if (line.startsWith('@@')) continue;

    const field = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\[\])?\??)/.exec(line);
    if (field?.[1] === undefined || field[2] === undefined) continue;

    fieldsByModel.get(currentModel)?.add(field[1]);
    candidates.push({ owner: currentModel, field: field[1], type: baseTypeName(field[2]) });
  }

  const modelSet = new Set(models);
  const relationFields: PrismaRelationField[] = candidates
    .filter((candidate) => modelSet.has(candidate.type))
    .map((candidate) => ({
      owner: candidate.owner,
      field: candidate.field,
      targetAccessor: delegateAccessor(candidate.type),
    }));

  return { models, relationFields, fieldsByModel };
}

/**
 * Models carrying every one of `tenantFields`, as Prisma delegate accessors.
 *
 * This is the schema's own answer to "which tables are tenant-bearing?", which
 * is the only answer that cannot fall behind a migration. The registries that
 * decide whether such a table is ISOLATED (a runtime `$extends` model map) and
 * whether it is LINTED (a rule's model option) are both hand-maintained, so the
 * schema is what they have to be reconciled against: agreeing with each other
 * proves nothing about a table neither has heard of.
 */
export function tenantBearingAccessors(
  parsed: ParsedPrismaSchema,
  tenantFields: readonly string[],
): string[] {
  const accessors: string[] = [];
  for (const [model, fields] of parsed.fieldsByModel) {
    if (tenantFields.every((field) => fields.has(field))) accessors.push(delegateAccessor(model));
  }
  return accessors.sort();
}

interface SchemaCacheEntry {
  readonly mtimeMs: number;
  readonly parsed: ParsedPrismaSchema;
}

/*
 * One parse per schema per lint run. ESLint constructs a rule context per file,
 * so without this the schema would be read and parsed once per file per rule.
 * Keyed on mtime as well as path so an edit mid-watch-run is picked up rather
 * than served stale.
 */
const schemaCache = new Map<string, SchemaCacheEntry>();

/** Absolute path of the schema to read for a file being linted. */
export function resolveSchemaPath(filename: string, schemaPath: string): string {
  if (path.isAbsolute(schemaPath)) return schemaPath;
  const root = findRepoRoot(path.dirname(path.resolve(filename)));
  return path.resolve(root ?? process.cwd(), schemaPath);
}

/**
 * Parse the schema at `absolutePath`, or null when it cannot be read.
 *
 * A missing schema fails QUIET here by design: the rule tester lints fixture
 * code with no schema at all, and a rule that threw there would be untestable.
 * The loud half belongs in the consumer: a test asserting its real schema is
 * where the configured path says it is, so a moved or renamed schema turns CI
 * red instead of silently disarming every fence.
 */
export function loadPrismaSchema(absolutePath: string): ParsedPrismaSchema | null {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
  } catch {
    return null;
  }

  // Every `.prisma` under the folder, sorted so the cache key and the parse
  // are stable across filesystem enumeration order. A directory's own mtime
  // does not move when a file INSIDE it is edited, so the cache is keyed on
  // the newest mtime across the set rather than on the directory's.
  let sources: readonly string[];
  let mtimeMs: number;
  try {
    if (stats.isDirectory()) {
      const files = collectSchemaFiles(absolutePath);
      if (files.length === 0) return null;
      sources = files;
      mtimeMs = files.reduce((newest, file) => Math.max(newest, statSync(file).mtimeMs), 0);
    } else {
      sources = [absolutePath];
      mtimeMs = stats.mtimeMs;
    }
  } catch {
    return null;
  }

  const cacheKey = `${absolutePath}\u0000${sources.join('\u0000')}`;
  const cached = schemaCache.get(cacheKey);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.parsed;

  let parsed: ParsedPrismaSchema;
  try {
    // Concatenated, not parsed per file and merged: a relation's target may be
    // declared in a different file than the field that points at it, and the
    // parser only needs to see every `model` block in one text to resolve that.
    parsed = parsePrismaSchema(sources.map((file) => readFileSync(file, 'utf8')).join('\n'));
  } catch {
    return null;
  }

  schemaCache.set(cacheKey, { mtimeMs, parsed });
  return parsed;
}

/** Every `.prisma` file under `dir`, recursively, in a stable order. */
function collectSchemaFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectSchemaFiles(full));
    } else if (entry.name.endsWith('.prisma')) {
      found.push(full);
    }
  }
  return found;
}

/** Field names that reach one of `guardedModels`, derived from a parsed schema. */
export function relationFieldsForModels(
  parsed: ParsedPrismaSchema,
  guardedModels: readonly string[],
): Set<string> {
  const guarded = new Set(guardedModels);
  const names = new Set<string>();
  for (const relation of parsed.relationFields) {
    if (guarded.has(relation.targetAccessor)) names.add(relation.field);
  }
  return names;
}
