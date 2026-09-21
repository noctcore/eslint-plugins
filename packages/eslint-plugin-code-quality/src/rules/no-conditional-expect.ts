/*
 * Ported from tsforge (MIT), https://github.com/boringstack-xyz/tsforge
 * Source: packages/core/src/rule-packs/test-conventions/rules/no-conditional-expect.ts
 * at commit 75100ffd54fafc4874375e28f6865198dcb91839.
 * Copyright (c) 2026 Aleksandar Grbic. See THIRD_PARTY_NOTICES.md for the license text.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-conditional-expect';

export interface NoConditionalExpectOptions {
  /** Treat an `expect` inside a loop body as conditional (the loop may run zero times). */
  readonly checkLoops?: boolean;
}

type RuleOptions = [NoConditionalExpectOptions];
type MessageIds = 'conditionalExpect';

/*
 * Off by default. The tsforge original treats every loop as conditional, but
 * on a real 650-file suite that flagged 164 table-driven loops (mostly over
 * literal arrays and constant maps) for every 9 genuine branches. Jest's own
 * `no-conditional-expect` makes the same call. Turn it on to also catch a loop
 * over a collection that may be empty.
 */
const DEFAULT_CHECK_LOOPS = false;

const BRANCH_TYPES = new Set<AST_NODE_TYPES>([
  AST_NODE_TYPES.IfStatement,
  AST_NODE_TYPES.SwitchCase,
  AST_NODE_TYPES.ConditionalExpression,
  AST_NODE_TYPES.LogicalExpression,
  AST_NODE_TYPES.CatchClause,
]);

const LOOP_TYPES = new Set<AST_NODE_TYPES>([
  AST_NODE_TYPES.ForStatement,
  AST_NODE_TYPES.ForInStatement,
  AST_NODE_TYPES.ForOfStatement,
  AST_NODE_TYPES.WhileStatement,
  AST_NODE_TYPES.DoWhileStatement,
]);

/** Callees whose callback is a test or suite body: the conditional search stops there. */
const RUNNERS = new Set(['it', 'test', 'describe', 'suite']);

/** `expect.assertions(n)` / `expect.hasAssertions()` make a skipped branch fail the test. */
const ASSERTION_COUNT_GUARDS = new Set(['assertions', 'hasAssertions']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checkLoops: { type: 'boolean' },
  },
};

type FunctionNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionExpression
  | TSESTree.FunctionDeclaration;

/** `expect(...)` or `obj.expect(...)` on an identifier (`t.expect`, `chai.expect`), not supertest's `.expect(200)`. */
function isExpectCall(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'expect';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'expect'
  );
}

function isAssertionCountGuard(node: TSESTree.CallExpression): boolean {
  const callee = node.callee;
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'expect' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    ASSERTION_COUNT_GUARDS.has(callee.property.name)
  );
}

/** Root identifier of a runner callee: `it`, `test.each(table)`, `describe.concurrent`. */
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

function isRunnerCallback(node: FunctionNode): boolean {
  const parent = node.parent;
  if (
    parent.type !== AST_NODE_TYPES.CallExpression ||
    !parent.arguments.some((argument) => argument === node)
  ) {
    return false;
  }
  const name = runnerName(parent.callee);
  return name !== null && RUNNERS.has(name);
}

function isFunctionNode(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
}

/** True when `child` is the part of `node` that runs unconditionally (an `if` test, a loop's init). */
function isUnconditionalPart(node: TSESTree.Node, child: TSESTree.Node): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.IfStatement:
    case AST_NODE_TYPES.ConditionalExpression:
      return node.test === child;
    case AST_NODE_TYPES.LogicalExpression:
      return node.left === child;
    case AST_NODE_TYPES.SwitchCase:
      return node.test === child;
    case AST_NODE_TYPES.ForStatement:
      return node.init === child;
    case AST_NODE_TYPES.ForInStatement:
    case AST_NODE_TYPES.ForOfStatement:
      return node.right === child;
    default:
      return false;
  }
}

export const noConditionalExpectRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `expect()` inside a branch, `catch` or loop that may not run: a skipped assertion lets a broken test pass.',
    },
    schema: [optionSchema],
    messages: {
      conditionalExpect:
        'This `expect()` sits inside a branch that may not run, so the test can pass without asserting anything. Assert unconditionally, or add `expect.assertions(n)` to the test.',
    },
  },
  defaultOptions: [{ checkLoops: DEFAULT_CHECK_LOOPS }],
  create(context, [options]) {
    const checkLoops = options.checkLoops ?? DEFAULT_CHECK_LOOPS;
    const pending = new Map<FunctionNode | null, TSESTree.CallExpression[]>();
    const guarded = new Set<FunctionNode | null>();

    function isConditional(type: AST_NODE_TYPES): boolean {
      return BRANCH_TYPES.has(type) || (checkLoops && LOOP_TYPES.has(type));
    }

    /**
     * Walk up from `node` to the enclosing test or suite callback (or the
     * program). Returns that boundary and whether a conditional ancestor lies
     * between. Stopping at the runner callback keeps a suite-level
     * `for (const c of cases) it(...)` from flagging the expects inside it.
     */
    function scan(node: TSESTree.Node): { boundary: FunctionNode | null; conditional: boolean } {
      let conditional = false;
      let child: TSESTree.Node = node;
      // `Program.parent` is typed `undefined` but is `null` at runtime.
      let current: TSESTree.Node | null | undefined = node.parent;
      while (current !== undefined && current !== null) {
        if (isFunctionNode(current) && isRunnerCallback(current)) {
          return { boundary: current, conditional };
        }
        if (isConditional(current.type) && !isUnconditionalPart(current, child)) {
          conditional = true;
        }
        child = current;
        current = current.parent;
      }
      return { boundary: null, conditional };
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (isAssertionCountGuard(node)) {
          guarded.add(scan(node).boundary);
          return;
        }
        if (!isExpectCall(node)) {
          return;
        }
        const { boundary, conditional } = scan(node);
        if (!conditional) {
          return;
        }
        const list = pending.get(boundary) ?? [];
        list.push(node);
        pending.set(boundary, list);
      },
      'Program:exit'(): void {
        for (const [boundary, calls] of pending) {
          if (guarded.has(boundary)) {
            continue;
          }
          for (const call of calls) {
            context.report({ node: call, messageId: 'conditionalExpect' });
          }
        }
      },
    };
  },
});
