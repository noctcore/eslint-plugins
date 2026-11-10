import { fileMatchesAnyGlob } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-bare-date-now';

export interface NoBareDateNowOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoBareDateNowOptions];
type MessageIds = 'dateNow' | 'newDate' | 'dateCall';

/*
 * Business logic must read wall-clock time through a shared `clock` util
 * (`now()` / `nowMs()`), not bare `Date.now()` / `new Date()`, so time-dependent
 * code has one mockable seam. Allowlisted by default: the clock util itself,
 * where a wall-clock abstraction is the wrong tool, and test files, which fake
 * the clock instead of injecting it. Only zero-argument `new Date()` is
 * flagged; `new Date(value)` (parsing an explicit instant) is fine. `Date()`
 * called as a function returns the current time as a string and is flagged,
 * as are the same reads through `globalThis.Date` / `window.Date`. Consumers override `allowIn` (globs matched against the file path) to
 * add their own infra/measurement sites.
 */
const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/clock.ts',
  '**/clock/**',
  '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/__tests__/**',
];

const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'window', 'global', 'self']);

/** `Date`, or `globalThis.Date` / `window.Date` / `global.Date` / `self.Date`. */
function isDateReference(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name === 'Date';
  }
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.object.type === AST_NODE_TYPES.Identifier &&
    GLOBAL_OBJECTS.has(node.object.name) &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'Date'
  );
}

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
    isDateReference(callee.object) &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'now'
  );
}

function isBareNewDate(node: TSESTree.NewExpression): boolean {
  return isDateReference(node.callee) && node.arguments.length === 0;
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
      dateNow: 'Read the time through the shared clock util (for example `nowMs()`) instead of bare `Date.now()`.',
      newDate: 'Read the time through the shared clock util (for example `now()`) instead of bare `new Date()`.',
      dateCall: 'Read the time through the shared clock util instead of calling `Date()`, which returns the current time as a string.',
    },
  },
  defaultOptions: [{ allowIn: [...DEFAULT_ALLOW_IN] }],
  create(context, [options]) {
    const allowIn = options.allowIn ?? DEFAULT_ALLOW_IN;

    if (fileMatchesAnyGlob(context.filename, allowIn, context.cwd)) {
      return {};
    }

    return {
      CallExpression(node): void {
        if (isDateNowCall(node)) {
          context.report({ node, messageId: 'dateNow' });
        } else if (isDateReference(node.callee)) {
          context.report({ node, messageId: 'dateCall' });
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
