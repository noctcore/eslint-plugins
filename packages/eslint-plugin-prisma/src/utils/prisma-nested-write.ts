import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

import type { ParsedPrismaSchema } from './prisma-schema';
import {
  delegateAccessor,
  loadPrismaSchema,
  relationFieldsForModels,
  resolveSchemaPath,
} from './prisma-schema';

/**
 * Shared nested-relation-write detection for single-writer fences: rules that
 * allow writes to a guarded model only from its owning service.
 *
 * Such a rule matches `<receiver>.<model>.<writeMethod>(` because that is how a
 * direct Prisma write is spelled. A nested write is spelled the other way
 * round: the model accessor names the PARENT, and the fenced model appears only
 * as a relation key inside the payload.
 *
 *     client.customer.update({ data: { invoices: { create: { ... } } } })
 *
 * That call writes an Invoice row without the string `client.invoice` ever
 * appearing, so the direct-write matcher never sees it. This is not evasion:
 * nested writes are idiomatic Prisma.
 *
 * Detection is by RELATION NAME, which is what keeps it free of false positives
 * on unrelated relations: only a key that names a field pointing at the fenced
 * model can match, so a nested write to some other relation is invisible here
 * by construction.
 *
 * Those names are DERIVED FROM the Prisma schema (see ./prisma-schema), not
 * guessed from the model name. `guardedRelations` remains as a manual addition
 * for anything outside the schema, and the model-name pair is kept as a floor
 * so the rules still bite in a checkout with no schema (the rule tester, for
 * one).
 *
 * TWO BLIND SPOTS, both accepted, both for the same reason: closing them would
 * cost more in false positives than the shapes are worth.
 *
 *   1. An ALIASED DELEGATE. `const d = tx.invoice; d.update(...)` never
 *      spells the model, and following it would need type information. The
 *      form is rare and reads as deliberate evasion.
 *
 *   2. A VARIABLE PAYLOAD. `customer.update(payload)`, the shorthand
 *      `customer.update({ where, data })` where `data` is a binding, and
 *      `data: { ...rest }` are all invisible: there is no object literal to
 *      walk. Unlike the alias case this is IDIOMATIC, not evasive, and it is
 *      exactly why it stays open. Enumerating those shapes would report every
 *      `customer.update(vars)` in a codebase, and a fence that fires on
 *      ordinary code gets disabled rather than obeyed. The direct-write
 *      matcher is unaffected: it keys on the model accessor, not on the
 *      payload, so `invoice.update(payload)` is still caught. What escapes
 *      is only a nested write whose payload the rule cannot read.
 */

/**
 * The nested write verbs Prisma accepts inside a relation payload. `connect`,
 * `disconnect` and `set` are absent on purpose: they relink existing rows
 * rather than creating, changing or removing them.
 */
export const NESTED_WRITE_VERBS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'connectOrCreate',
]);

export interface NestedWrite {
  /** The relation property itself, e.g. the `invoices: { create: ... }` node. */
  readonly property: TSESTree.Property;
  /** The relation key that matched, e.g. `invoices`. */
  readonly relation: string;
  /** The nested write verb found under it, e.g. `create`. */
  readonly verb: string;
}

/** The static key of a non-computed object property, if it has one. */
export function staticKeyName(node: TSESTree.Property): string | null {
  if (node.computed) return null;
  if (node.key.type === AST_NODE_TYPES.Identifier) return node.key.name;
  if (node.key.type === AST_NODE_TYPES.Literal && typeof node.key.value === 'string') {
    return node.key.value;
  }
  return null;
}

/**
 * The name-shaped FLOOR: the model name itself (a to-one relation) and its
 * default plural (a to-many one), plus whatever `extra` names were configured.
 *
 * This is what the fence had before it learned to read the schema. It is kept
 * only so the rules still catch the conventional shapes where no schema can be
 * read, and it is unioned with, never substituted for, the derived names.
 */
export function relationNamesFor(
  models: readonly string[],
  extra: readonly string[] = [],
): Set<string> {
  const names = new Set<string>(extra);
  for (const model of models) {
    names.add(model);
    names.add(model.endsWith('y') ? `${model.slice(0, -1)}ies` : `${model}s`);
  }
  return names;
}

export interface GuardedRelationRequest {
  /** The file being linted, used to find the workspace root. */
  readonly filename: string;
  /** Schema location: absolute, or relative to the workspace root. */
  readonly schemaPath: string;
  /** Prisma delegate accessors the fence guards, e.g. `['invoice']`. */
  readonly guardedModels: readonly string[];
  /** Relation names configured by hand, for anything the schema cannot say. */
  readonly extraRelations: readonly string[];
}

/*
 * Derivation is per (guarded models, extra names) and hangs off the PARSED
 * schema object rather than off its path, so a schema edited mid-run yields a
 * fresh parse object and therefore a fresh derivation with no staleness window.
 * A whole lint run then costs one read, one parse, and one `statSync` per file
 * per rule.
 */
const relationCache = new WeakMap<ParsedPrismaSchema, Map<string, Set<string>>>();

/**
 * Every relation field name a nested write could reach a guarded model through:
 * the fields `schema.prisma` actually declares, plus the name-shaped floor,
 * plus any configured extras.
 */
export function guardedRelationNames(request: GuardedRelationRequest): Set<string> {
  const parsed = loadPrismaSchema(resolveSchemaPath(request.filename, request.schemaPath));

  // No schema in reach (the rule tester, a partial checkout): fall back to the
  // name-shaped floor rather than to nothing at all.
  if (parsed === null) {
    return relationNamesFor(request.guardedModels, request.extraRelations);
  }

  const key = `${request.guardedModels.join(',')}|${request.extraRelations.join(',')}`;
  const perSchema = relationCache.get(parsed) ?? new Map<string, Set<string>>();
  const cached = perSchema.get(key);
  if (cached !== undefined) return cached;

  const names = relationNamesFor(request.guardedModels, request.extraRelations);
  for (const derived of relationFieldsForModels(parsed, request.guardedModels)) {
    names.add(derived);
  }

  perSchema.set(key, names);
  relationCache.set(parsed, perSchema);
  return names;
}

/**
 * Relation fields DECLARED ON one of the guarded models that point back at one
 * of them (`Invoice.supersedes -> Invoice`), from the schema only.
 *
 * `guardedRelationNames` answers "which keys reach a guarded model", which is
 * right for a payload on SOME OTHER model. Inside a payload on the guarded model
 * itself it is too loose: a key is only a relation there if the guarded model
 * declares it, and a name borrowed from another model's relation is just a
 * column. So a write on a guarded model is checked against this narrower set,
 * and with no schema in reach it is empty rather than guessed.
 */
export function guardedSelfRelationNames(request: GuardedRelationRequest): Set<string> {
  const names = new Set<string>();
  const parsed = loadPrismaSchema(resolveSchemaPath(request.filename, request.schemaPath));
  if (parsed === null) return names;
  const guarded = new Set(request.guardedModels);
  for (const relation of parsed.relationFields) {
    if (guarded.has(delegateAccessor(relation.owner)) && guarded.has(relation.targetAccessor)) {
      names.add(relation.field);
    }
  }
  return names;
}

/** True when an object payload names at least one nested write verb. */
function nestedVerbIn(node: TSESTree.ObjectExpression): string | null {
  for (const property of node.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const key = staticKeyName(property);
    if (key !== null && NESTED_WRITE_VERBS.has(key)) return key;
  }
  return null;
}

/**
 * Every nested write to one of `relations` reachable from `node`, at any depth.
 *
 * The walk descends through objects and arrays so a relation nested two levels
 * down (`data: { account: { update: { data: { invoices: ... } } } }`) is still
 * found, and stops descending once a relation key matches, since one report per
 * nested write is enough.
 */
export function findNestedWrites(
  node: TSESTree.Node | undefined,
  relations: ReadonlySet<string>,
): NestedWrite[] {
  const found: NestedWrite[] = [];
  if (node === undefined || relations.size === 0) return found;

  const visit = (current: TSESTree.Node): void => {
    if (current.type === AST_NODE_TYPES.ArrayExpression) {
      for (const element of current.elements) {
        if (element !== null) visit(element);
      }
      return;
    }
    if (current.type !== AST_NODE_TYPES.ObjectExpression) return;

    for (const property of current.properties) {
      if (property.type !== AST_NODE_TYPES.Property) continue;

      const key = staticKeyName(property);
      if (key !== null && relations.has(key)) {
        if (property.value.type === AST_NODE_TYPES.ObjectExpression) {
          const verb = nestedVerbIn(property.value);
          if (verb !== null) {
            found.push({ property, relation: key, verb });
            continue;
          }
        }
      }

      visit(property.value);
    }
  };

  visit(node);
  return found;
}
