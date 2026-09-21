/*
 * Ported from tsforge (MIT), https://github.com/boringstack-xyz/tsforge
 * Source: packages/core/src/rule-packs/test-conventions/rules/no-vacuous-expect.ts
 * at commit 75100ffd54fafc4874375e28f6865198dcb91839.
 * Copyright (c) 2026 Aleksandar Grbic. See THIRD_PARTY_NOTICES.md for the license text.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-vacuous-expect';

export interface NoVacuousExpectOptions {
  /**
   * Matchers that cannot carry a test on their own. A `not.` prefix names the
   * negated form, so `not.toBeUndefined` is the same check as `toBeDefined`.
   */
  readonly weakMatchers?: readonly string[];
  /**
   * Regex sources (compiled with the `u` flag) for callees that also count as
   * an assertion, so a test that pairs a weak `expect` with `assert.equal(...)`
   * or a custom `expectValidUser(...)` helper is not reported. Matched against
   * `name` for a bare call, `obj.name` for a member call on an identifier and
   * `.name` for any other member call.
   */
  readonly assertionCallees?: readonly string[];
}

type RuleOptions = [NoVacuousExpectOptions];
type MessageIds = 'typeofExpect' | 'tautologyExpect' | 'soleWeakExpect';

const DEFAULT_WEAK_MATCHERS: readonly string[] = [
  'toBeDefined',
  'toBeTruthy',
  'toBeFalsy',
  'not.toBeUndefined',
];

const DEFAULT_ASSERTION_CALLEES: readonly string[] = ['^assert', '^expect\\w', '\\.expect$'];

const TYPEOF_RESULTS = new Set([
  'undefined',
  'object',
  'boolean',
  'number',
  'bigint',
  'string',
  'symbol',
  'function',
]);

const EQUALITY_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

const TEST_RUNNERS = new Set(['it', 'test']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    weakMatchers: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    assertionCallees: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    },
  },
};

type TestCallback = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

interface TestFrame {
  readonly node: TestCallback;
  assertions: number;
  weak: { node: TSESTree.CallExpression; matcher: string } | null;
}

interface MatcherCall {
  /** The `expect(...)` call at the root of the chain. */
  readonly root: TSESTree.CallExpression;
  /** Matcher name, prefixed with `not.` when the chain negates it. */
  readonly matcher: string;
}

function isExpectCall(node: TSESTree.Node): node is TSESTree.CallExpression {
  return (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'expect'
  );
}

/** Decompose `expect(x).not.resolves.toBe(y)` into its root and matcher, or null. */
function matcherCall(node: TSESTree.CallExpression): MatcherCall | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  let negated = false;
  let current: TSESTree.Expression = callee.object;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    if (
      !current.computed &&
      current.property.type === AST_NODE_TYPES.Identifier &&
      current.property.name === 'not'
    ) {
      negated = !negated;
    }
    current = current.object;
  }
  if (!isExpectCall(current)) {
    return null;
  }
  const name = callee.property.name;
  return { root: current, matcher: negated ? `not.${name}` : name };
}

/** `name`, `obj.name` or `.name` for a callee, used to match `assertionCallees`. */
function calleePath(callee: TSESTree.Expression): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    const owner = callee.object.type === AST_NODE_TYPES.Identifier ? callee.object.name : '';
    return `${owner}.${callee.property.name}`;
  }
  return null;
}

/** Root identifier of a test callee: `it`, `test.concurrent`, `it.each(table)`, ``test.each`...` ``. */
function runnerName(callee: TSESTree.Node): string | null {
  let current: TSESTree.Node = callee;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.CallExpression) {
      current = current.callee;
    } else if (current.type === AST_NODE_TYPES.TaggedTemplateExpression) {
      current = current.tag;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : null;
}

function isTestCallback(node: TestCallback): boolean {
  const parent = node.parent;
  if (parent.type !== AST_NODE_TYPES.CallExpression || parent.arguments[1] !== node) {
    return false;
  }
  const name = runnerName(parent.callee);
  return name !== null && TEST_RUNNERS.has(name);
}

function isTypeofExpression(node: TSESTree.Node | undefined): boolean {
  return node?.type === AST_NODE_TYPES.UnaryExpression && node.operator === 'typeof';
}

function isTypeofResult(node: TSESTree.Node | undefined): boolean {
  return (
    node?.type === AST_NODE_TYPES.Literal &&
    typeof node.value === 'string' &&
    TYPEOF_RESULTS.has(node.value)
  );
}

/** Two literals with the same value: `expect(true).toBe(true)`, `expect(1).toEqual(1)`. */
function isLiteralTautology(
  actual: TSESTree.Node | undefined,
  expected: TSESTree.Node | undefined,
): boolean {
  return (
    actual?.type === AST_NODE_TYPES.Literal &&
    expected?.type === AST_NODE_TYPES.Literal &&
    !('regex' in actual) &&
    actual.value === expected.value
  );
}

export const noVacuousExpectRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow vacuous expects (`typeof` checks, literal tautologies, a sole `toBeDefined`/`toBeTruthy`): a test must assert behaviour that a real regression would break.',
    },
    schema: [optionSchema],
    messages: {
      typeofExpect:
        'Do not assert on `typeof`; that only proves a binding exists. Assert a result, a thrown error or an observable effect.',
      tautologyExpect:
        'This expect compares a literal with itself and can never fail. Assert something a real regression would break.',
      soleWeakExpect:
        'A sole `{{matcher}}` does not pin behaviour. Assert on the value or the outcome, or delete the test.',
    },
  },
  defaultOptions: [
    {
      weakMatchers: [...DEFAULT_WEAK_MATCHERS],
      assertionCallees: [...DEFAULT_ASSERTION_CALLEES],
    },
  ],
  create(context, [options]) {
    const weakMatchers = new Set(options.weakMatchers ?? DEFAULT_WEAK_MATCHERS);
    const assertionCallees = (options.assertionCallees ?? DEFAULT_ASSERTION_CALLEES).map(
      (source) => new RegExp(source, 'u'),
    );
    const stack: TestFrame[] = [];

    function enter(node: TestCallback): void {
      if (isTestCallback(node)) {
        stack.push({ node, assertions: 0, weak: null });
      }
    }

    function exit(node: TestCallback): void {
      const frame = stack.at(-1);
      if (frame?.node !== node) {
        return;
      }
      stack.pop();
      if (frame.assertions === 1 && frame.weak !== null) {
        context.report({
          node: frame.weak.node,
          messageId: 'soleWeakExpect',
          data: { matcher: frame.weak.matcher },
        });
      }
    }

    return {
      ArrowFunctionExpression: enter,
      FunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,
      'FunctionExpression:exit': exit,
      CallExpression(node: TSESTree.CallExpression): void {
        const frame = stack.at(-1);
        const call = matcherCall(node);
        if (call === null) {
          const path = calleePath(node.callee);
          if (frame !== undefined && path !== null && assertionCallees.some((re) => re.test(path))) {
            frame.assertions += 1;
          }
          return;
        }

        if (frame !== undefined) {
          frame.assertions += 1;
          if (weakMatchers.has(call.matcher)) {
            frame.weak = { node, matcher: call.matcher };
          }
        }

        const negated = call.matcher.startsWith('not.');
        const base = negated ? call.matcher.slice('not.'.length) : call.matcher;
        if (!EQUALITY_MATCHERS.has(base)) {
          return;
        }
        const actual = call.root.arguments[0];
        const expected = node.arguments[0];
        if (isTypeofExpression(actual) && isTypeofResult(expected)) {
          context.report({ node, messageId: 'typeofExpect' });
        } else if (!negated && isLiteralTautology(actual, expected)) {
          context.report({ node, messageId: 'tautologyExpect' });
        }
      },
    };
  },
});
