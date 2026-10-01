/*
 * Ported from tsforge (MIT), https://github.com/boringstack-xyz/tsforge
 * Source: packages/core/src/rule-packs/test-conventions/rules/no-vacuous-expect.ts
 * at commit 75100ffd54fafc4874375e28f6865198dcb91839.
 * Copyright (c) 2026 Aleksandar Grbic. See THIRD_PARTY_NOTICES.md for the license text.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { runnerName } from '../utils/ast';

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
  /**
   * Names of the render root a DOM test render returns (`container`,
   * `baseElement`, also as `view.container`). A test whose only assertion is
   * that the root, its first child or its HTML is present is reported. An
   * empty list turns the check off.
   */
  readonly renderRoots?: readonly string[];
}

type RuleOptions = [NoVacuousExpectOptions];
type MessageIds = 'typeofExpect' | 'tautologyExpect' | 'soleWeakExpect' | 'soleRenderRootExpect';

const DEFAULT_WEAK_MATCHERS: readonly string[] = [
  'toBeDefined',
  'toBeTruthy',
  'toBeFalsy',
  'not.toBeUndefined',
];

const DEFAULT_ASSERTION_CALLEES: readonly string[] = ['^assert', '^expect\\w', '\\.expect$'];

const DEFAULT_RENDER_ROOTS: readonly string[] = ['container', 'baseElement'];

/** Members of a render root that only say something rendered: `container.firstChild`. */
const RENDER_ROOT_MEMBERS = new Set([
  'firstChild',
  'firstElementChild',
  'lastChild',
  'innerHTML',
  'outerHTML',
  'textContent',
]);

/** Presence matchers that exist only for DOM nodes, so their subject is one whatever returned it. */
const DOM_ONLY_MATCHERS = new Set(['toBeInTheDocument', 'toBeVisible', 'not.toBeEmptyDOMElement']);

/** Matchers that, on a render root, only prove the render produced something. */
const RENDER_ROOT_PRESENCE_MATCHERS = new Set([
  ...DOM_ONLY_MATCHERS,
  'toBeTruthy',
  'toBeDefined',
  'not.toBeNull',
  'not.toBeUndefined',
  'not.toBeFalsy',
]);

/** Negated equality matchers that are presence checks when compared with `''`. */
const EMPTY_STRING_PRESENCE_MATCHERS = new Set(['not.toBe', 'not.toEqual', 'not.toStrictEqual']);

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
    renderRoots: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
  },
};

type TestCallback = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

interface TestFrame {
  readonly node: TestCallback;
  assertions: number;
  weak: { node: TSESTree.CallExpression; matcher: string; messageId: MessageIds } | null;
}

interface MatcherCall {
  /** The `expect(...)` call at the root of the chain. */
  readonly root: TSESTree.CallExpression;
  /** Matcher name, prefixed with `not.` when the chain negates it. */
  readonly matcher: string;
}

/**
 * What a render root comes from: a `render*` call, which proves it is a DOM node, or some other
 * call (`setup()`, `docker.inspect(id)`), which does not.
 */
type RootOrigin = 'render' | 'call';

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

function memberName(node: TSESTree.MemberExpression): string | null {
  return !node.computed && node.property.type === AST_NODE_TYPES.Identifier
    ? node.property.name
    : null;
}

/** `x` for `await x`, else the node itself. */
function unwrapAwait(node: TSESTree.Node | null | undefined): TSESTree.Node | null {
  if (node === null || node === undefined) {
    return null;
  }
  return node.type === AST_NODE_TYPES.AwaitExpression ? node.argument : node;
}

/** True for a call to a `render*` function: `render(...)`, `renderIntoDocument(...)`, `rtl.render(...)`. */
function isRenderCall(node: TSESTree.Node | null): boolean {
  if (node?.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const callee = node.callee;
  const name =
    callee.type === AST_NODE_TYPES.Identifier
      ? callee.name
      : callee.type === AST_NODE_TYPES.MemberExpression
        ? memberName(callee)
        : null;
  return name !== null && name.startsWith('render');
}

/** The origin a call gives its result, or null when `node` is not a call. */
function callOrigin(node: TSESTree.Node | null): RootOrigin | null {
  if (node?.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }
  return isRenderCall(node) ? 'render' : 'call';
}

/** True when `matcher(expected)` only proves the subject is present or non-empty. */
function isPresenceMatcher(matcher: string, expected: TSESTree.Node | undefined): boolean {
  if (RENDER_ROOT_PRESENCE_MATCHERS.has(matcher)) {
    return true;
  }
  return (
    EMPTY_STRING_PRESENCE_MATCHERS.has(matcher) &&
    expected?.type === AST_NODE_TYPES.Literal &&
    expected.value === ''
  );
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
        'Disallow vacuous expects (`typeof` checks, literal tautologies, a sole `toBeDefined`/`toBeTruthy`, a sole presence check on the render root): a test must assert behaviour that a real regression would break.',
    },
    schema: [optionSchema],
    messages: {
      typeofExpect:
        'Do not assert on `typeof`; that only proves a binding exists. Assert a result, a thrown error or an observable effect.',
      tautologyExpect:
        'This expect compares a literal with itself and can never fail. Assert something a real regression would break.',
      soleWeakExpect:
        'A sole `{{matcher}}` does not pin behaviour. Assert on the value or the outcome, or delete the test.',
      soleRenderRootExpect:
        'The only assertion is that the render root is present (`{{matcher}}`), which passes for anything that renders, an error fallback included. Assert on what the user sees: a role, a label or a text.',
    },
  },
  defaultOptions: [
    {
      weakMatchers: [...DEFAULT_WEAK_MATCHERS],
      assertionCallees: [...DEFAULT_ASSERTION_CALLEES],
      renderRoots: [...DEFAULT_RENDER_ROOTS],
    },
  ],
  create(context, [options]) {
    const weakMatchers = new Set(options.weakMatchers ?? DEFAULT_WEAK_MATCHERS);
    const assertionCallees = (options.assertionCallees ?? DEFAULT_ASSERTION_CALLEES).map(
      (source) => new RegExp(source, 'u'),
    );
    const renderRoots = new Set(options.renderRoots ?? DEFAULT_RENDER_ROOTS);
    const stack: TestFrame[] = [];

    /** The declarator that binds `identifier`, when it is a `const` / `let` / `var` binding. */
    function declaratorOf(identifier: TSESTree.Identifier): TSESTree.VariableDeclarator | null {
      let scope: ReturnType<typeof context.sourceCode.getScope> | null =
        context.sourceCode.getScope(identifier);
      while (scope !== null) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined) {
          const node = variable.defs[0]?.node;
          return node?.type === AST_NODE_TYPES.VariableDeclarator ? node : null;
        }
        scope = scope.upper;
      }
      return null;
    }

    /** The origin of a call result: a call, or a binding initialised from one. Else null. */
    function resultOrigin(node: TSESTree.Node): RootOrigin | null {
      const direct = callOrigin(unwrapAwait(node));
      if (direct !== null || node.type !== AST_NODE_TYPES.Identifier) {
        return direct;
      }
      return callOrigin(unwrapAwait(declaratorOf(node)?.init));
    }

    /**
     * The origin of a render root that comes from a call: `const { container } = render(...)`,
     * `const container = render(...).container`, `const container = renderIntoDocument(...)`,
     * `view.container` where `view = render(...)`, or `render(...).container`. Null for a name
     * that is not a render root or does not come from a call. A root bound whole
     * (`const container = call()`) must come from a `render*` call: only a destructure or a
     * member read says the call returned an object with a root on it.
     */
    function rootOrigin(node: TSESTree.Node): RootOrigin | null {
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        const name = memberName(node);
        return name !== null && renderRoots.has(name) ? resultOrigin(node.object) : null;
      }
      if (node.type !== AST_NODE_TYPES.Identifier || !renderRoots.has(node.name)) {
        return null;
      }
      const declarator = declaratorOf(node);
      const init = unwrapAwait(declarator?.init);
      if (declarator === null || init === null) {
        return null;
      }
      if (declarator.id.type === AST_NODE_TYPES.ObjectPattern) {
        return callOrigin(init);
      }
      if (isRenderCall(init)) {
        return 'render';
      }
      return init.type === AST_NODE_TYPES.MemberExpression ? rootOrigin(init) : null;
    }

    /**
     * True for an expect subject that is the render root or a presence-only member of it. A
     * root from a call that is not a `render*` function counts only when the assertion is
     * DOM-specific: the subject reads a DOM member off it, or `matcher` exists only for DOM nodes.
     */
    function isRenderRootSubject(node: TSESTree.Node | undefined, matcher: string): boolean {
      if (node === undefined) {
        return false;
      }
      const origin = rootOrigin(node);
      if (origin !== null) {
        return origin === 'render' || DOM_ONLY_MATCHERS.has(matcher);
      }
      if (node.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }
      const name = memberName(node);
      return name !== null && RENDER_ROOT_MEMBERS.has(name) && rootOrigin(node.object) !== null;
    }

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
          messageId: frame.weak.messageId,
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
          if (
            isRenderRootSubject(call.root.arguments[0], call.matcher) &&
            isPresenceMatcher(call.matcher, node.arguments[0])
          ) {
            frame.weak = { node, matcher: call.matcher, messageId: 'soleRenderRootExpect' };
          } else if (weakMatchers.has(call.matcher)) {
            frame.weak = { node, matcher: call.matcher, messageId: 'soleWeakExpect' };
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
