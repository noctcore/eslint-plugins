import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isAllowlisted } from '../utils/allowlist';
import {
  PRISMA_DELETE_METHODS,
  PRISMA_FILTERED_WRITE_METHODS,
  PRISMA_READ_METHODS,
  PRISMA_SCOPED_READ_METHODS,
  PRISMA_UPDATE_METHODS,
} from '../utils/prisma-methods';
import {
  type ReceiverOptions,
  chainResolvesToUnscoped,
  nameListSchema,
  nonEmptyNameListSchema,
  receiverPatternSchema,
  resolveReceiverOptions,
  unscopedPropertySchema,
} from '../utils/prisma-receiver';

const RULE_NAME = 'tenant-scoped-tables-require-where';

export interface TenantScopedTablesRequireWhereOptions
  extends Pick<ReceiverOptions, 'receiverPattern' | 'unscopedProperty'> {
  /** Prisma delegate accessors the tenant-scope extension isolates (`invoice`, not `Invoice`). */
  readonly tenantModels?: readonly string[];
  /**
   * Tenant columns that must ALL appear in `where`. A single-axis model lists
   * `['tenantId']`; a model scoped on two axes lists both, so the static guard
   * enforces the full composite scope rather than the outer one alone.
   */
  readonly tenantFields?: readonly string[];
  /** Globs of files this rule does not police. Empty by default. */
  readonly allowIn?: readonly string[];
  /**
   * Models the tenant extension does NOT scope, mapped to the columns that stand
   * in for it: a query on one must filter by at least ONE of them, on every
   * receiver and every method that takes a `where`.
   */
  readonly handScopedModels?: Readonly<Record<string, readonly string[]>>;
}

type RuleOptions = [TenantScopedTablesRequireWhereOptions];
type MessageIds = 'missingTenantWhere' | 'missingHandScopedWhere';

/*
 * The request-path client (`this.prisma.client.invoice`, `tx.invoice`) has the
 * tenant columns injected by a `$extends` extension, so policing it here would
 * be pure noise. This rule guards the UNSCOPED escape hatch
 * (`this.prisma.unscoped.invoice`), which injects nothing: a read or bulk
 * mutation on a tenant model through it must carry every tenant field in its
 * `where` or it reads and writes across tenants.
 *
 * Heuristic only (identifier names, member-expression shapes and single-hop
 * scope resolution, no type information):
 *   - the method is a filtered read or a filtered bulk write;
 *   - the receiver is a `<...>.<model>` accessor named in `tenantModels`;
 *   - the receiver chain reaches the unscoped client, directly or through a
 *     local binding resolved back to `.unscoped` or a `{ unscoped }` destructure;
 *   - the first argument's `where` object is missing one of the `tenantFields`.
 *
 * `findUnique`, `findUniqueOrThrow`, `update`, `delete` and `upsert` are exempt:
 * they take a unique selector, not a scope filter. Report-only: injecting a
 * `where` clause is not a trivially safe autofix.
 *
 * `handScopedModels` is the other half, and it inverts every one of those
 * choices. Those models are scoped by NO client, so the receiver does not
 * matter and a unique selector is no safer than a filter
 * (`notification.findUnique({ where: { id } })` handed to a user is an IDOR).
 * The check is "does this `where` mention a scope column at all", anywhere in
 * its tree, on every receiver and on every method that takes one.
 */
const GUARDED_METHODS: ReadonlySet<string> = new Set([
  ...PRISMA_SCOPED_READ_METHODS,
  ...PRISMA_FILTERED_WRITE_METHODS,
]);

/**
 * Every method whose first argument carries a `where`, unique selector or not.
 * A hand-scoped model has no injected filter on ANY of them.
 */
const HAND_SCOPED_METHODS: ReadonlySet<string> = new Set([
  ...PRISMA_READ_METHODS,
  ...PRISMA_UPDATE_METHODS,
  ...PRISMA_DELETE_METHODS,
]);

/* Empty: which models are tenant-scoped is the project's registry, never a guess. */
const DEFAULT_TENANT_MODELS: readonly string[] = [];
const DEFAULT_TENANT_FIELDS: readonly string[] = ['tenantId'];
/* Empty: an exemption is only ever granted from the config, never by default. */
const DEFAULT_ALLOW_IN: readonly string[] = [];
/* Empty: a hand-scoped model is an app-level decision, declared in the config. */
const DEFAULT_HAND_SCOPED_MODELS: Readonly<Record<string, readonly string[]>> = {};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tenantModels: nameListSchema,
    tenantFields: nonEmptyNameListSchema,
    allowIn: nameListSchema,
    handScopedModels: {
      type: 'object',
      additionalProperties: nonEmptyNameListSchema,
    },
    receiverPattern: receiverPatternSchema,
    unscopedProperty: unscopedPropertySchema,
  },
};

/** The `where` property of an argument object literal, if it has one. */
function findWhereProperty(arg: TSESTree.ObjectExpression): TSESTree.Property | undefined {
  return arg.properties.find(
    (prop): prop is TSESTree.Property =>
      prop.type === AST_NODE_TYPES.Property &&
      !prop.computed &&
      prop.key.type === AST_NODE_TYPES.Identifier &&
      prop.key.name === 'where',
  );
}

/** True when an object literal has a non-computed property named `name`. */
function objectHasKey(obj: TSESTree.ObjectExpression, name: string): boolean {
  return obj.properties.some(
    (prop) =>
      prop.type === AST_NODE_TYPES.Property &&
      !prop.computed &&
      prop.key.type === AST_NODE_TYPES.Identifier &&
      prop.key.name === name,
  );
}

/**
 * True when the first call argument is an object literal whose `where` is an
 * object literal containing EVERY tenant field (`{ tenantId }` or
 * `{ tenantId: ... }`). A missing argument, a missing `where` or a `where`
 * missing any one field is non-compliant.
 */
function whereHasAllTenantFields(
  arg: TSESTree.Node | undefined,
  tenantFields: readonly string[],
): boolean {
  if (arg === undefined || arg.type !== AST_NODE_TYPES.ObjectExpression) {
    return false;
  }
  const whereProp = findWhereProperty(arg);
  if (whereProp === undefined || whereProp.value.type !== AST_NODE_TYPES.ObjectExpression) {
    return false;
  }
  const whereObject = whereProp.value;
  return tenantFields.every((field) => objectHasKey(whereObject, field));
}

/**
 * True when `node` mentions one of `fields` as a filter key anywhere inside it.
 *
 * A hand-scoped `where` is rarely flat: a feed ANDs its filters and ORs
 * visibility arms, one of which may reach the scope through a relation
 * (`{ tenantId: null, user: { tenantId } }`). So this walks object properties
 * and array elements rather than the top level only.
 *
 * It walks SYNTAX, never bindings: a clause lifted into a `const` reads as no
 * scope at all and is reported. That is deliberate. The scope of a hand-scoped
 * read is the one thing that must stay visible at the call site.
 */
function mentionsAnyField(node: TSESTree.Node, fields: readonly string[]): boolean {
  if (node.type === AST_NODE_TYPES.ObjectExpression) {
    return node.properties.some((prop) => {
      if (prop.type !== AST_NODE_TYPES.Property || prop.computed) {
        return false;
      }
      if (prop.key.type === AST_NODE_TYPES.Identifier && fields.includes(prop.key.name)) {
        return true;
      }
      return mentionsAnyField(prop.value, fields);
    });
  }
  if (node.type === AST_NODE_TYPES.ArrayExpression) {
    return node.elements.some((element) => element !== null && mentionsAnyField(element, fields));
  }
  return false;
}

/**
 * True when the first call argument's `where` mentions at least ONE of the
 * hand-scope fields. A missing argument or `where` is non-compliant: an
 * unfiltered read of a hand-scoped model returns every row in the table.
 */
function whereMentionsAnyScopeField(
  arg: TSESTree.Node | undefined,
  fields: readonly string[],
): boolean {
  if (arg === undefined || arg.type !== AST_NODE_TYPES.ObjectExpression) {
    return false;
  }
  const whereProp = findWhereProperty(arg);
  if (whereProp === undefined) {
    return false;
  }
  return mentionsAnyField(whereProp.value, fields);
}

export const tenantScopedTablesRequireWhereRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every tenant field in the `where` of a read or bulk write on a tenant-scoped model through the unscoped client, and a scope column in the `where` of any query on a hand-scoped model.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      missingTenantWhere:
        'A query on the tenant-scoped `{{model}}` through the unscoped client must filter by {{fields}} in its where clause. The unscoped client does not inject the tenant scope.',
      missingHandScopedWhere:
        'A query on `{{model}}` must filter by one of: {{fields}}. The tenant extension does not scope this model on ANY client, so this where clause is the only boundary it has. Spell the scope inline: a clause lifted into a const is invisible here.',
    },
  },
  defaultOptions: [
    {
      tenantModels: [...DEFAULT_TENANT_MODELS],
      tenantFields: [...DEFAULT_TENANT_FIELDS],
      allowIn: [...DEFAULT_ALLOW_IN],
      handScopedModels: { ...DEFAULT_HAND_SCOPED_MODELS },
    },
  ],
  create(context, [options]) {
    if (isAllowlisted(context.filename, options.allowIn ?? DEFAULT_ALLOW_IN)) {
      return {};
    }

    const tenantModels = new Set(options.tenantModels ?? DEFAULT_TENANT_MODELS);
    const tenantFields = options.tenantFields ?? DEFAULT_TENANT_FIELDS;
    const handScopedModels = options.handScopedModels ?? DEFAULT_HAND_SCOPED_MODELS;
    const receivers = resolveReceiverOptions(options);

    return {
      CallExpression(node): void {
        const callee = node.callee;
        // Method must be a non-computed `.<method>(...)`.
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        const method = callee.property.name;
        // Receiver must be a non-computed `<...>.<model>` accessor.
        const modelAccessor = callee.object;
        if (
          modelAccessor.type !== AST_NODE_TYPES.MemberExpression ||
          modelAccessor.computed ||
          modelAccessor.property.type !== AST_NODE_TYPES.Identifier
        ) {
          return;
        }
        const model = modelAccessor.property.name;

        // Hand-scoped models first: they are checked on every receiver, so the
        // unscoped-only path below would never see them.
        if (Object.hasOwn(handScopedModels, model)) {
          const scopeFields = handScopedModels[model] ?? [];
          if (
            HAND_SCOPED_METHODS.has(method) &&
            !whereMentionsAnyScopeField(node.arguments[0], scopeFields)
          ) {
            context.report({
              node,
              messageId: 'missingHandScopedWhere',
              data: { model, fields: scopeFields.join(', ') },
            });
          }
          return;
        }

        if (!GUARDED_METHODS.has(method) || !tenantModels.has(model)) {
          return;
        }
        // Only the unscoped client is policed; the extended client auto-scopes.
        // Bare-identifier receivers are resolved through their binding so a
        // local alias cannot bypass the rule.
        if (
          !chainResolvesToUnscoped(
            modelAccessor.object,
            context.sourceCode.getScope(node),
            receivers,
          )
        ) {
          return;
        }
        if (!whereHasAllTenantFields(node.arguments[0], tenantFields)) {
          context.report({
            node,
            messageId: 'missingTenantWhere',
            data: { model, fields: tenantFields.join(' and ') },
          });
        }
      },
    };
  },
});
