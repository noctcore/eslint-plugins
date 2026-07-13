import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'require-registered-keys';

export interface RegisteredKeySink {
  /** Dotted callee path whose key argument must be a registered constant (e.g. `localStorage.getItem`). */
  readonly callee: string;
  /** Zero-based index of the key/name argument to police. */
  readonly argIndex: number;
}

export interface RequireRegisteredKeysOptions {
  /** Sink APIs whose key argument must be an imported constant, not a raw string. Empty = rule is inert. */
  readonly sinks?: readonly RegisteredKeySink[];
  /** Optional module the constants should be imported from, named in the report. */
  readonly registry?: string;
}

type RuleOptions = [RequireRegisteredKeysOptions];
type MessageIds = 'unregisteredKey';

/*
 * String keys threaded into sink APIs — storage slots, event channels, feature
 * flags, query-cache keys — are a classic drift hazard: one call spells the key
 * `"user-profile"`, another `"userProfile"`, and the two silently never meet.
 * This rule flags a RAW STRING LITERAL in the configured key position of a
 * configured sink and asks for an imported constant from a single registry
 * module instead.
 *
 * INERT UNTIL CONFIGURED: `sinks` defaults to empty, so the rule reports nothing
 * until a project declares which callees and argument positions to police —
 * there is no universal set of key sinks to hard-code. Only string literals are
 * flagged; an already-imported identifier, a template literal, or any computed
 * expression is left alone (those are not the raw-string smell).
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sinks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['callee', 'argIndex'],
        properties: {
          callee: { type: 'string', minLength: 1 },
          argIndex: { type: 'integer', minimum: 0 },
        },
      },
    },
    registry: { type: 'string', minLength: 1 },
  },
};

/**
 * The dotted callee path of a call (`localStorage.getItem`, `emitter.on`), or
 * null when any link is computed or not a plain identifier chain (`this.x`,
 * `a().b`, `obj[k].on`) — those cannot be matched against a string config entry.
 */
function calleePath(callee: TSESTree.Expression): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (callee.type === AST_NODE_TYPES.MemberExpression && !callee.computed) {
    if (callee.property.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    const objectPath = calleePath(callee.object as TSESTree.Expression);
    return objectPath === null ? null : `${objectPath}.${callee.property.name}`;
  }
  return null;
}

/** True when the argument is a raw string literal (the smell we replace with a constant). */
function isStringLiteral(node: TSESTree.CallExpressionArgument): node is TSESTree.StringLiteral {
  return node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string';
}

export const requireRegisteredKeysRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require the key/name argument of configured sink APIs (storage, event channels, cache keys) to be an imported constant from a registry module, not a raw string literal.',
    },
    schema: [optionSchema],
    messages: {
      unregisteredKey:
        'Pass an imported key constant to `{{callee}}`, not the raw string {{value}}{{registryHint}}. Raw string keys drift out of sync across call sites.',
    },
  },
  defaultOptions: [{ sinks: [] }],
  create(context, [options]) {
    const sinks = options.sinks ?? [];
    if (sinks.length === 0) {
      return {};
    }

    // callee path -> the argument indexes to police for it.
    const sinkMap = new Map<string, Set<number>>();
    for (const sink of sinks) {
      const existing = sinkMap.get(sink.callee);
      if (existing) {
        existing.add(sink.argIndex);
      } else {
        sinkMap.set(sink.callee, new Set([sink.argIndex]));
      }
    }

    const registry = options.registry;
    const registryHint = registry ? ` (import it from '${registry}')` : '';

    return {
      CallExpression(node): void {
        const path = calleePath(node.callee as TSESTree.Expression);
        if (path === null) {
          return;
        }
        const indexes = sinkMap.get(path);
        if (indexes === undefined) {
          return;
        }
        for (const index of indexes) {
          const arg = node.arguments[index];
          if (arg !== undefined && isStringLiteral(arg)) {
            context.report({
              node: arg,
              messageId: 'unregisteredKey',
              data: { callee: path, value: `'${arg.value}'`, registryHint },
            });
          }
        }
      },
    };
  },
});
