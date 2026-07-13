import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { matchesAny } from '../utils/allowMatch';
import { createRule } from '../createRule';

const RULE_NAME = 'no-bare-date-now';

export interface NoBareDateNowOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoBareDateNowOptions];
type MessageIds = 'dateNow' | 'newDate';

/*
 * Business logic must read wall-clock time through a shared `clock` util
 * (`now()` / `nowMs()`), not bare `Date.now()` / `new Date()`, so time-dependent
 * code has one mockable seam. Allowlisted by default: the clock util itself,
 * where a wall-clock abstraction is the wrong tool. Only zero-argument
 * `new Date()` is flagged; `new Date(value)` (parsing an explicit instant) is
 * fine. Consumers override `allowIn` (globs matched against the file path) to
 * add their own infra/measurement sites.
 */
const DEFAULT_ALLOW_IN: readonly string[] = ['**/clock.ts', '**/clock/**'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

function isDateNowCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'Date' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'now'
  );
}

function isBareNewDate(node: TSESTree.NewExpression): boolean {
  return (
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'Date' &&
    node.arguments.length === 0
  );
}

export const noBareDateNowRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow bare `Date.now()` / `new Date()` in business logic. Read wall-clock time through a shared `clock` util (`nowMs()` / `now()`) so time is mockable.',
    },
    schema: [optionSchema],
    messages: {
      dateNow: 'Use `nowMs()` from the shared `clock` util instead of bare `Date.now()`.',
      newDate: 'Use `now()` from the shared `clock` util instead of bare `new Date()`.',
    },
  },
  defaultOptions: [{ allowIn: [...DEFAULT_ALLOW_IN] }],
  create(context, [options]) {
    const allowIn = options.allowIn ?? DEFAULT_ALLOW_IN;

    if (matchesAny(context.filename, allowIn)) {
      return {};
    }

    return {
      CallExpression(node): void {
        if (isDateNowCall(node)) {
          context.report({ node, messageId: 'dateNow' });
        }
      },
      NewExpression(node): void {
        if (isBareNewDate(node)) {
          context.report({ node, messageId: 'newDate' });
        }
      },
    };
  },
});
