import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { PRISMA_READ_METHODS, PRISMA_WRITE_METHODS } from '../utils/prisma-methods';
import { nameListSchema } from '../utils/prisma-receiver';

const RULE_NAME = 'no-cross-tenant-id-in-where';

export interface NoCrossTenantIdInWhereOptions {
  /**
   * Prisma delegate accessors to police. Omitted means every model: a tenant id
   * taken from client input is an IDOR whichever table it filters.
   */
  readonly tenantModels?: readonly string[];
  /** Field name that carries the tenant id. */
  readonly tenantField?: string;
  /** Root identifiers that represent untrusted client input. */
  readonly untrustedRoots?: readonly string[];
}

type RuleOptions = [NoCrossTenantIdInWhereOptions];
type MessageIds = 'untrustedTenantSource';

/*
 * IDOR / provenance guard. With no RLS, the tenantId set on a Prisma
 * query/write is the primary cross-tenant boundary. If that tenantId VALUE is
 * traced back to a client-controlled root (input/dto/body/query/params/req),
 * a caller can read or mutate another tenant's rows by supplying a foreign id.
 *
 * Heuristic (no type info): a CallExpression to a Prisma write or query method
 * (create, update, delete, upsert, find, count, aggregate, groupBy variants) on
 * a receiver whose model accessor is in `tenantModels` (every model when the
 * option is omitted). Its first arg object is inspected for `where` and/or
 * `data`; within each, a `tenantField` (default 'tenantId') property is found
 * and its value node is traced. If the value is a MemberExpression chain rooted
 * at an untrusted root identifier, it is reported. Server-side sources
 * (`getTenantId()`, `ctx.tenantId`, `store.tenantId`) are calls or chains rooted
 * at other identifiers and so never trip the untrusted-root test. Report-only:
 * the fix is to swap the value source, which is not a mechanically safe autofix.
 */
const DEFAULT_TENANT_FIELD = 'tenantId';
const DEFAULT_UNTRUSTED_ROOTS = ['input', 'dto', 'body', 'query', 'params', 'req'] as const;

const PRISMA_METHODS = new Set([...PRISMA_WRITE_METHODS, ...PRISMA_READ_METHODS]);

const INSPECTED_ARG_KEYS = ['where', 'data'] as const;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tenantModels: nameListSchema,
    tenantField: { type: 'string', minLength: 1 },
    untrustedRoots: nameListSchema,
  },
};

/** Plain identifier name of a property key, or null for computed/string keys we do not match. */
function staticKeyName(prop: TSESTree.ObjectLiteralElement): string | null {
  if (prop.type !== AST_NODE_TYPES.Property || prop.computed) {
    return null;
  }
  if (prop.key.type === AST_NODE_TYPES.Identifier) {
    return prop.key.name;
  }
  if (prop.key.type === AST_NODE_TYPES.Literal && typeof prop.key.value === 'string') {
    return prop.key.value;
  }
  return null;
}

/** Find the value node for a property named `name` in an object expression. */
function findPropertyValue(
  obj: TSESTree.ObjectExpression,
  name: string,
): TSESTree.Expression | null {
  for (const prop of obj.properties) {
    if (staticKeyName(prop) === name && prop.type === AST_NODE_TYPES.Property) {
      return prop.value as TSESTree.Expression;
    }
  }
  return null;
}

/** Walk a member-expression chain to its base; return the root Identifier name, or null. */
function rootIdentifierName(node: TSESTree.Node): string | null {
  let current: TSESTree.Node = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    current = current.object;
  }
  if (current.type === AST_NODE_TYPES.Identifier) {
    return current.name;
  }
  return null;
}

/** The Prisma model accessor name on a `<receiver>.<method>` callee, e.g. `invoice` in `x.invoice.findMany`. */
function modelAccessorName(methodCallee: TSESTree.MemberExpression): string | null {
  const receiver = methodCallee.object;
  if (
    receiver.type === AST_NODE_TYPES.MemberExpression &&
    !receiver.computed &&
    receiver.property.type === AST_NODE_TYPES.Identifier
  ) {
    return receiver.property.name;
  }
  // bare receiver: `invoice.findMany(...)`
  if (receiver.type === AST_NODE_TYPES.Identifier) {
    return receiver.name;
  }
  return null;
}

export const noCrossTenantIdInWhereRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a Prisma query or write whose tenant id in `where` or `data` is read from client input. Without row-level security, a client-supplied tenant id is a cross-tenant access (IDOR).',
    },
    schema: [optionSchema],
    messages: {
      untrustedTenantSource:
        'The `{{field}}` in this query is read from client input (`{{root}}`). Take it from server context (the session or request tenant) instead: a client-supplied tenant id is a cross-tenant access (IDOR).',
    },
  },
  defaultOptions: [
    {
      tenantField: DEFAULT_TENANT_FIELD,
      untrustedRoots: [...DEFAULT_UNTRUSTED_ROOTS],
    },
  ],
  create(context, [options]) {
    const tenantModels = options.tenantModels === undefined ? null : new Set(options.tenantModels);
    const tenantField = options.tenantField ?? DEFAULT_TENANT_FIELD;
    const untrustedRoots = new Set(options.untrustedRoots ?? DEFAULT_UNTRUSTED_ROOTS);

    /** The untrusted client root a tenant id value is read from, or null when it is not. */
    function untrustedRootOf(value: TSESTree.Expression): string | null {
      if (value.type !== AST_NODE_TYPES.MemberExpression) {
        return null;
      }
      const root = rootIdentifierName(value);
      return root !== null && untrustedRoots.has(root) ? root : null;
    }

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          !PRISMA_METHODS.has(callee.property.name)
        ) {
          return;
        }

        const model = modelAccessorName(callee);
        if (model === null || (tenantModels !== null && !tenantModels.has(model))) {
          return;
        }

        const firstArg = node.arguments[0];
        if (firstArg === undefined || firstArg.type !== AST_NODE_TYPES.ObjectExpression) {
          return;
        }

        for (const key of INSPECTED_ARG_KEYS) {
          const section = findPropertyValue(firstArg, key);
          if (section === null || section.type !== AST_NODE_TYPES.ObjectExpression) {
            continue;
          }
          const tenantValue = findPropertyValue(section, tenantField);
          const root = tenantValue === null ? null : untrustedRootOf(tenantValue);
          if (tenantValue !== null && root !== null) {
            context.report({
              node: tenantValue,
              messageId: 'untrustedTenantSource',
              data: { field: tenantField, root },
            });
          }
        }
      },
    };
  },
});
