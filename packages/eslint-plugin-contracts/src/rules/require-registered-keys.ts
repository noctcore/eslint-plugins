import { calleePath } from '@noctcore/eslint-utils';
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
 *
 * A sink with two or more segments also matches as a dotted SUFFIX of the
 * callee path, so `redis.set` covers `this.redis.set(...)` in a NestJS service
 * and `localStorage.getItem` covers `window.localStorage.getItem(...)`. A
 * one-segment sink (`emit`) matches only a bare call of that name.
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
      requiresOptions: true,
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

    /** The configured sink for `path`: exact, or a dotted suffix of two or more segments. */
    function matchSink(path: string): [string, Set<number>] | null {
      const exact = sinkMap.get(path);
      if (exact !== undefined) {
        return [path, exact];
      }
      const segments = path.split('.');
      for (let start = 1; start <= segments.length - 2; start += 1) {
        const suffix = segments.slice(start).join('.');
        const indexes = sinkMap.get(suffix);
        if (indexes !== undefined) {
          return [suffix, indexes];
        }
      }
      return null;
    }

    const registry = options.registry;
    const registryHint = registry ? ` (import it from '${registry}')` : '';

    return {
      CallExpression(node): void {
        const path = calleePath(node.callee, { allowThis: true });
        if (path === null) {
          return;
        }
        const match = matchSink(path);
        if (match === null) {
          return;
        }
        const [sinkName, indexes] = match;
        for (const index of indexes) {
          const arg = node.arguments[index];
          if (arg !== undefined && isStringLiteral(arg)) {
            context.report({
              node: arg,
              messageId: 'unregisteredKey',
              data: { callee: sinkName, value: `'${arg.value}'`, registryHint },
            });
          }
        }
      },
    };
  },
});
