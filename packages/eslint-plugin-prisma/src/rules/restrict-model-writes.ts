import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isAllowlisted } from '../utils/allowlist';
import {
  PRISMA_CREATE_METHODS,
  PRISMA_DELETE_METHODS,
  PRISMA_UPDATE_METHODS,
} from '../utils/prisma-methods';
import {
  findNestedWrites,
  guardedRelationNames,
  guardedSelfRelationNames,
  staticKeyName,
} from '../utils/prisma-nested-write';
import { nameListSchema, nonEmptyNameListSchema } from '../utils/prisma-receiver';
import { DEFAULT_SCHEMA_PATH } from '../utils/prisma-schema';

const RULE_NAME = 'restrict-model-writes';

/** One fence: which models, who may write them, and optionally which columns. */
export interface ModelWriteRestriction {
  /** Prisma delegate accessors this fence guards (`invoice`, not `Invoice`). */
  readonly models: readonly string[];
  /**
   * Globs of the files permitted to write those models: the owning service,
   * its repository, their specs, and usually seeds and migrations. Matched
   * against the absolute and the workspace-root-relative path. Nothing is
   * implicit: a file not listed here is outside the fence.
   */
  readonly allowedFiles: readonly string[];
  /**
   * Columns the fence is scoped to. Omitted, EVERY write to the models is
   * fenced. Set, only writes that set one of these columns are, plus any
   * payload the rule cannot read (it cannot prove the column is absent) and
   * every delete (removing the row is the last write to every column).
   */
  readonly fields?: readonly string[];
  /**
   * Relation field names the models are reached under in a nested write, ON
   * TOP of the ones derived from the Prisma schema. Only needed for a path the
   * schema cannot describe.
   */
  readonly relations?: readonly string[];
  /** Who owns the writes, named in every message, e.g. `InvoiceService`. */
  readonly owner?: string;
  /** Why, appended to every message, e.g. the invariant the owner maintains. */
  readonly reason?: string;
}

export interface RestrictModelWritesOptions {
  /** The fences. None by default: the rule reports nothing until one is declared. */
  readonly restrictions?: readonly ModelWriteRestriction[];
  /**
   * The schema nested-write relation names are derived from: absolute, or
   * relative to the workspace root. A file or a `prismaSchemaFolder` directory.
   */
  readonly schemaPath?: string;
}

type RuleOptions = [RestrictModelWritesOptions];
type MessageIds =
  | 'writeOutsideOwner'
  | 'nestedWriteOutsideOwner'
  | 'fieldWriteOutsideOwner'
  | 'opaqueWritePayload'
  | 'deleteOutsideOwner';

/*
 * Some rows are only correct when one service writes them: it keeps a derived
 * column in step, writes the side rows that go with the change, or moves a
 * state column by compare-and-swap so a concurrent writer loses instead of both
 * winning. A router, a job or a well-meaning bug fix calling
 * `prisma.<model>.update(...)` directly satisfies the type checker, passes every
 * test and quietly leaves those invariants lying. This rule fences writes to the
 * owning files.
 *
 * WHAT IT DOES NOT DO. It decides WHO may write a model (and, with `fields`,
 * which columns). It does not know which values or state transitions are legal:
 * a write inside `allowedFiles` from any state to any state passes. Transition
 * legality belongs in the owning service's compare-and-swap; this rule's job is
 * to make sure that service is the only way in.
 *
 * Two modes per fence:
 *
 *   - MODEL-scoped (no `fields`): every create/update/upsert/delete/*Many on a
 *     guarded model outside `allowedFiles` is reported. Reads are untouched.
 *   - FIELD-scoped (`fields`): only a create/update/upsert payload that sets a
 *     guarded column is reported, so touching an unrelated column from
 *     elsewhere is fine. Because the rule must PROVE the column is absent, a
 *     payload it cannot read (a spread, a variable, a computed key, an argument
 *     object with no payload key) is reported as opaque, and every delete is
 *     reported: deleting the row writes every column at once.
 *
 * In both modes a NESTED write reaching a guarded model through a relation on
 * some other model (`customer.update({ data: { invoices: { create } } })`) is
 * reported whatever its payload: a nested write cannot compare-and-swap (its
 * where clause is scoped to the parent and it returns no row count), so there
 * is no safe nested write from outside the owner. Relation names are DERIVED
 * FROM the Prisma schema (see utils/prisma-nested-write), plus `relations`.
 *
 * Heuristic, no type information: it matches `<anything>.<model>.<method>(`.
 * Two accepted blind spots, documented in utils/prisma-nested-write: an aliased
 * delegate (`const d = tx.invoice; d.update(...)`), and a nested write hidden in
 * a variable payload on ANOTHER model. A direct write keys on the accessor, so
 * `invoice.update(payload)` is still caught.
 */
const PAYLOAD_METHODS: ReadonlySet<string> = new Set([
  ...PRISMA_CREATE_METHODS,
  ...PRISMA_UPDATE_METHODS,
]);
const DELETE_METHODS: ReadonlySet<string> = new Set(PRISMA_DELETE_METHODS);

/** The argument keys holding a writable payload, per method. */
const PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = {
  create: ['data'],
  createMany: ['data'],
  createManyAndReturn: ['data'],
  update: ['data'],
  updateMany: ['data'],
  updateManyAndReturn: ['data'],
  upsert: ['create', 'update'],
};

const DEFAULT_OWNER = 'the files allowed to write it';

const restrictionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['models', 'allowedFiles'],
  properties: {
    models: nonEmptyNameListSchema,
    allowedFiles: nameListSchema,
    fields: nonEmptyNameListSchema,
    relations: nameListSchema,
    owner: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    restrictions: { type: 'array', items: restrictionSchema },
    schemaPath: { type: 'string', minLength: 1 },
  },
};

/** The static property name of a non-computed member expression, if it has one. */
function staticPropertyName(node: TSESTree.MemberExpression): string | null {
  if (node.computed) return null;
  return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : null;
}

/** A fence resolved for the file being linted. */
interface ActiveFence {
  readonly models: ReadonlySet<string>;
  readonly relations: ReadonlySet<string>;
  /** Relations the guarded models declare to themselves (field-scoped fences only). */
  readonly selfRelations: ReadonlySet<string>;
  readonly fields: readonly string[] | null;
  readonly owner: string;
  readonly reason: string;
}

export const restrictModelWritesRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Restrict Prisma writes to configured models (or to configured columns of them) to the files that own those writes, including nested relation writes. It fences who writes; it does not validate which values or state transitions are legal.',
    },
    schema: [optionSchema],
    messages: {
      writeOutsideOwner:
        'Writing `{{model}}` here bypasses {{owner}}, the only permitted writer of this model.{{reason}}',
      nestedWriteOutsideOwner:
        'The nested `{{relation}}.{{verb}}` payload writes a model only {{owner}} may write, bypassing it just as a direct write does.{{reason}}',
      fieldWriteOutsideOwner:
        'Setting `{{model}}.{{field}}` here bypasses {{owner}}, the only permitted writer of this column.{{reason}}',
      opaqueWritePayload:
        'This `{{model}}.{{method}}` payload cannot be read statically, so the rule cannot prove it leaves `{{fields}}` alone. Pass an inline payload, or go through {{owner}}.',
      deleteOutsideOwner:
        'Deleting `{{model}}` rows here bypasses {{owner}}: removing a row writes every guarded column at once.{{reason}}',
    },
  },
  defaultOptions: [{ restrictions: [], schemaPath: DEFAULT_SCHEMA_PATH }],
  create(context, [options]) {
    const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
    const fences: ActiveFence[] = [];
    for (const restriction of options.restrictions ?? []) {
      if (isAllowlisted(context.filename, restriction.allowedFiles)) continue;
      const request = {
        filename: context.filename,
        schemaPath,
        guardedModels: restriction.models,
        extraRelations: restriction.relations ?? [],
      };
      fences.push({
        models: new Set(restriction.models),
        relations: guardedRelationNames(request),
        selfRelations:
          restriction.fields === undefined ? new Set() : guardedSelfRelationNames(request),
        fields: restriction.fields ?? null,
        owner: restriction.owner ?? DEFAULT_OWNER,
        reason: restriction.reason === undefined ? '' : ` ${restriction.reason}`,
      });
    }

    if (fences.length === 0) {
      return {};
    }

    const reportNested = (
      fence: ActiveFence,
      argument: TSESTree.Node | undefined,
      relations: ReadonlySet<string> = fence.relations,
    ): void => {
      for (const nested of findNestedWrites(argument, relations)) {
        context.report({
          node: nested.property,
          messageId: 'nestedWriteOutsideOwner',
          data: {
            relation: nested.relation,
            verb: nested.verb,
            owner: fence.owner,
            reason: fence.reason,
          },
        });
      }
    };

    /** MODEL-scoped fence: every write to a guarded model is reported. */
    const checkModelFence = (
      fence: ActiveFence,
      node: TSESTree.CallExpression,
      model: string,
      method: string,
    ): void => {
      if (!PAYLOAD_METHODS.has(method) && !DELETE_METHODS.has(method)) return;
      if (fence.models.has(model)) {
        context.report({
          node,
          messageId: 'writeOutsideOwner',
          data: { model, owner: fence.owner, reason: fence.reason },
        });
        return;
      }
      reportNested(fence, node.arguments[0]);
    };

    /** FIELD-scoped fence: writes that set, or may set, a guarded column. */
    const checkFieldFence = (
      fence: ActiveFence,
      fields: readonly string[],
      node: TSESTree.CallExpression,
      model: string,
      method: string,
    ): void => {
      const isPayloadMethod = PAYLOAD_METHODS.has(method);
      const isDeleteMethod = DELETE_METHODS.has(method);
      if (!isPayloadMethod && !isDeleteMethod) return;

      if (!fence.models.has(model)) {
        // Deletes carry no payload, so only the payload methods nest.
        if (isPayloadMethod) reportNested(fence, node.arguments[0]);
        return;
      }

      if (isDeleteMethod) {
        // `deleteMany()` with no arguments is legal Prisma and deletes every
        // row, so zero-arg deletes are reported rather than skipped.
        context.report({
          node,
          messageId: 'deleteOutsideOwner',
          data: { model, owner: fence.owner, reason: fence.reason },
        });
        return;
      }

      // No Prisma payload method is callable without an argument, so a zero-arg
      // call is something else that merely shares the name.
      if (node.arguments.length === 0) return;

      // A self-relation (`invoice.update({ data: { supersedes: { update } } })`)
      // writes ANOTHER guarded row through this payload, whatever it sets here.
      // Only relations the schema declares on the guarded model count: any
      // other key in its payload is a column, whatever it is called elsewhere.
      reportNested(fence, node.arguments[0], fence.selfRelations);

      const fieldSet = new Set(fields);
      const reportOpaque = (at: TSESTree.Node): void => {
        context.report({
          node: at,
          messageId: 'opaqueWritePayload',
          data: { model, method, fields: fields.join(' / '), owner: fence.owner },
        });
      };

      const checkPayloadObject = (payload: TSESTree.Node): void => {
        if (payload.type !== AST_NODE_TYPES.ObjectExpression) {
          reportOpaque(payload);
          return;
        }
        for (const property of payload.properties) {
          if (property.type === AST_NODE_TYPES.SpreadElement) {
            // `{ ...changes }` could carry a guarded column.
            reportOpaque(property);
            continue;
          }
          const key = staticKeyName(property);
          if (key === null) {
            // A computed key, e.g. `{ [column]: value }`.
            reportOpaque(property);
            continue;
          }
          if (fieldSet.has(key)) {
            context.report({
              node: property,
              messageId: 'fieldWriteOutsideOwner',
              data: { model, field: key, owner: fence.owner, reason: fence.reason },
            });
          }
        }
      };

      const [argument] = node.arguments;
      if (argument === undefined || argument.type !== AST_NODE_TYPES.ObjectExpression) {
        reportOpaque(argument ?? node);
        return;
      }

      const payloadKeys = PAYLOAD_KEYS[method] ?? ['data'];
      let sawPayloadKey = false;
      for (const property of argument.properties) {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          // `update({ ...args })`: the payload itself is hidden.
          reportOpaque(property);
          sawPayloadKey = true;
          continue;
        }
        const key = staticKeyName(property);
        if (key === null || !payloadKeys.includes(key)) continue;
        sawPayloadKey = true;

        // `createMany({ data: [...] })` takes a list of payloads.
        if (property.value.type === AST_NODE_TYPES.ArrayExpression) {
          for (const element of property.value.elements) {
            if (element !== null) checkPayloadObject(element);
          }
          continue;
        }
        checkPayloadObject(property.value);
      }

      if (!sawPayloadKey) {
        // Prisma requires a payload for every one of these methods, so an
        // argument object without one is a shape the rule cannot follow.
        reportOpaque(argument);
      }
    };

    return {
      CallExpression(node): void {
        // Shape: <receiver>.<model>.<writeMethod>(...)
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) return;
        const method = staticPropertyName(callee);
        if (method === null) return;
        const modelAccessor = callee.object;
        if (modelAccessor.type !== AST_NODE_TYPES.MemberExpression) return;
        const model = staticPropertyName(modelAccessor);
        if (model === null) return;

        for (const fence of fences) {
          if (fence.fields === null) {
            checkModelFence(fence, node, model, method);
          } else {
            checkFieldFence(fence, fence.fields, node, model, method);
          }
        }
      },
    };
  },
});
