import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { enclosingFunction } from '../utils/ast';

const RULE_NAME = 'prefer-web-first-page-assertions';

export interface PreferWebFirstPageAssertionsOptions {
  /**
   * Names of the Playwright page fixture. A read counts when it is called on a
   * binding with one of these names (`page.url()`) or on a member with one
   * (`this.page.url()`, `ctx.page.url()`).
   */
  readonly pages?: readonly string[];
}

type RuleOptions = [PreferWebFirstPageAssertionsOptions];
type MessageIds = 'oneShotRead' | 'useMatcher';

const DEFAULT_PAGES: readonly string[] = ['page'];

/** One-shot page reads and the web-first matcher that retries the same check. */
const RETRYING_MATCHERS: ReadonlyMap<string, string> = new Map([
  ['url', 'toHaveURL'],
  ['title', 'toHaveTitle'],
]);

/** Matchers whose expected value means the same thing to the retrying matcher. */
const EQUALITY_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pages: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
      description:
        'Names of the Playwright page fixture, matched as a binding (`page.url()`) or as a member (`this.page.url()`).',
    },
  },
};

interface PageRead {
  /** The `page.url()` call. */
  readonly call: TSESTree.CallExpression;
  /** The receiver the read was called on (`page`, `this.page`). */
  readonly receiver: TSESTree.Expression;
  /** `url` or `title`. */
  readonly method: string;
}

/** True for `expect(...)` and `expect.soft(...)`. */
function isExpectCall(node: TSESTree.Node): node is TSESTree.CallExpression {
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'expect';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'expect' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'soft'
  );
}

/**
 * True for a callback that Playwright already retries: the block of
 * `expect(async () => { ... }).toPass()` and the getter of
 * `expect.poll(() => ...)`.
 */
function isRetryingCallback(fn: TSESTree.Node): boolean {
  const parent = fn.parent;
  if (parent?.type !== AST_NODE_TYPES.CallExpression || parent.arguments[0] !== fn) {
    return false;
  }
  const callee = parent.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'expect';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'expect' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'poll'
  );
}

/**
 * The `expect(...)` call whose subject contains `node`, without crossing a
 * function boundary (a read inside a callback runs whenever the callback does).
 * Null when there is none.
 */
function subjectExpect(node: TSESTree.Node): TSESTree.CallExpression | null {
  let child: TSESTree.Node = node;
  let current = node.parent;
  while (current !== undefined) {
    if (
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionDeclaration
    ) {
      return null;
    }
    if (isExpectCall(current) && current.arguments[0] === child) {
      return current;
    }
    child = current;
    current = current.parent;
  }
  return null;
}

/** True when some function around `node` is a block Playwright retries. */
function insideRetryingCallback(node: TSESTree.Node): boolean {
  let fn = enclosingFunction(node);
  while (fn !== null) {
    if (isRetryingCallback(fn)) {
      return true;
    }
    fn = enclosingFunction(fn);
  }
  return false;
}

/** `x` for `await x`, else the node itself. */
function unwrapAwait(node: TSESTree.Node): TSESTree.Node {
  return node.type === AST_NODE_TYPES.AwaitExpression ? node.argument : node;
}

interface MatcherChain {
  /** The whole `expect(...).not.toBe(...)` call. */
  readonly call: TSESTree.CallExpression;
  readonly matcher: string;
  readonly negated: boolean;
}

/** The matcher call chained directly on `expect(...)`, with at most one `.not`. Null otherwise. */
function matcherChain(expectCall: TSESTree.CallExpression): MatcherChain | null {
  let member = expectCall.parent;
  let negated = false;
  if (
    member?.type === AST_NODE_TYPES.MemberExpression &&
    member.object === expectCall &&
    !member.computed &&
    member.property.type === AST_NODE_TYPES.Identifier &&
    member.property.name === 'not'
  ) {
    negated = true;
    member = member.parent;
  }
  if (
    member?.type !== AST_NODE_TYPES.MemberExpression ||
    member.computed ||
    member.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  const call = member.parent;
  if (call?.type !== AST_NODE_TYPES.CallExpression || call.callee !== member) {
    return null;
  }
  return { call, matcher: member.property.name, negated };
}

/**
 * True when the retrying matcher accepts `expected` with the same meaning:
 * any value after an equality matcher, a regex literal after `toMatch`.
 */
function isTranslatable(matcher: string, expected: TSESTree.Node): boolean {
  if (EQUALITY_MATCHERS.has(matcher)) {
    return true;
  }
  return matcher === 'toMatch' && expected.type === AST_NODE_TYPES.Literal && 'regex' in expected;
}

export const preferWebFirstPageAssertionsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow asserting on a one-shot Playwright page read (`expect(page.url())`, `expect(await page.title())`): the check runs once, possibly before the navigation lands. Use the retrying `toHaveURL` / `toHaveTitle`.',
    },
    hasSuggestions: true,
    schema: [optionSchema],
    messages: {
      oneShotRead:
        'Reading `{{read}}` inside expect() checks it once, possibly before the page settles. Use `await expect({{page}}).{{matcher}}(...)`, which retries ({{matcher}} also takes a regex or a predicate).',
      useMatcher: 'Replace with `await expect({{page}}).{{matcher}}(...)`.',
    },
  },
  defaultOptions: [{ pages: [...DEFAULT_PAGES] }],
  create(context, [options]) {
    const pages = new Set(options.pages ?? DEFAULT_PAGES);
    const sourceCode = context.sourceCode;

    function isPage(node: TSESTree.Expression): boolean {
      if (node.type === AST_NODE_TYPES.Identifier) {
        return pages.has(node.name);
      }
      return (
        node.type === AST_NODE_TYPES.MemberExpression &&
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        pages.has(node.property.name)
      );
    }

    function pageRead(node: TSESTree.CallExpression): PageRead | null {
      const callee = node.callee;
      if (
        node.arguments.length !== 0 ||
        callee.type !== AST_NODE_TYPES.MemberExpression ||
        callee.computed ||
        callee.property.type !== AST_NODE_TYPES.Identifier ||
        !RETRYING_MATCHERS.has(callee.property.name) ||
        !isPage(callee.object)
      ) {
        return null;
      }
      return { call: node, receiver: callee.object, method: callee.property.name };
    }

    /**
     * The suggestion for `expect(page.url()).toBe(x);` as a whole statement in
     * an async function: `await expect(page).toHaveURL(x);`. Null for any other
     * shape, where a rewrite could change what is checked.
     */
    function suggestion(
      read: PageRead,
      expectCall: TSESTree.CallExpression,
      matcher: string,
    ): TSESLint.ReportFixFunction | null {
      if (unwrapAwait(expectCall.arguments[0] as TSESTree.Node) !== read.call) {
        return null;
      }
      const chain = matcherChain(expectCall);
      const expected = chain?.call.arguments[0];
      if (
        chain === null ||
        chain.call.arguments.length !== 1 ||
        expected === undefined ||
        expected.type === AST_NODE_TYPES.SpreadElement ||
        !isTranslatable(chain.matcher, expected)
      ) {
        return null;
      }
      const awaited = chain.call.parent;
      const expression = awaited.type === AST_NODE_TYPES.AwaitExpression ? awaited : chain.call;
      if (expression.parent.type !== AST_NODE_TYPES.ExpressionStatement) {
        return null;
      }
      const fn = enclosingFunction(expression);
      if (fn?.async !== true) {
        return null;
      }
      const replacement = [
        'await ',
        sourceCode.getText(expectCall.callee),
        `(${sourceCode.getText(read.receiver)})`,
        chain.negated ? '.not' : '',
        `.${matcher}(${sourceCode.getText(expected)})`,
      ].join('');
      return (fixer) => fixer.replaceText(expression, replacement);
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const read = pageRead(node);
        if (read === null) {
          return;
        }
        const expectCall = subjectExpect(node);
        if (expectCall === null || insideRetryingCallback(expectCall)) {
          return;
        }
        const matcher = RETRYING_MATCHERS.get(read.method) as string;
        const page = sourceCode.getText(read.receiver);
        const data = { read: sourceCode.getText(node), page, matcher };
        const fix = suggestion(read, expectCall, matcher);
        context.report({
          node,
          messageId: 'oneShotRead',
          data,
          suggest: fix === null ? [] : [{ messageId: 'useMatcher', data, fix }],
        });
      },
    };
  },
});
