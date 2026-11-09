import { calleePath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'prefer-lazy-state-init';

export interface PreferLazyStateInitOptions {
  readonly initializers?: readonly string[];
}

type RuleOptions = [PreferLazyStateInitOptions];
type MessageIds = 'lazyInit';

/*
 * `useState(expensiveCall())` evaluates its initializer on EVERY render — React
 * only uses the first result, so every subsequent call is wasted work (and, for
 * `JSON.parse`/`localStorage.getItem`, real cost). Wrapping the initializer in a
 * function (`useState(() => expensiveCall())`) makes React run it once, lazily,
 * on mount.
 *
 * The rule fires only when the state initializer is a call whose callee path is
 * in `initializers` (default `JSON.parse`, `localStorage.getItem`,
 * `sessionStorage.getItem`). Add your own builders (`buildInitialState`,
 * `crypto.randomUUID`, ...) to widen it. A callee is matched by its dotted path
 * (`localStorage.getItem`) or bare name (`buildInitialState`); anything already
 * wrapped in an arrow/function is left alone. Autofixable.
 */
const DEFAULT_INITIALIZERS: readonly string[] = [
  'JSON.parse',
  'localStorage.getItem',
  'sessionStorage.getItem',
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    initializers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

/**
 * The same path with a global object prefix removed.
 *
 * `localStorage.getItem` and `window.localStorage.getItem` are one call written
 * two ways, and both forms are common. Matching the dotted path literally saw
 * only the bare one, so configuring `localStorage.getItem` silently missed every
 * `window.`-prefixed call site.
 */
function withoutGlobalPrefix(path: string): string {
  for (const prefix of ['window.', 'globalThis.', 'self.']) {
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }
  return path;
}

/** True when `callee` is `useState` or `<something>.useState`. */
function isUseStateCallee(callee: TSESTree.Node): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'useState';
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'useState'
  );
}

/**
 * The call an initializer evaluates unconditionally on every render: the
 * argument itself, or the call under a TypeScript wrapper (`JSON.parse(raw) as
 * Foo`, `!`, `satisfies`) or on the left of `??` / `||` (`JSON.parse(raw) ?? {}`).
 */
function unwrapEagerCall(node: TSESTree.Expression): TSESTree.CallExpression | null {
  let current: TSESTree.Expression = node;
  for (;;) {
    switch (current.type) {
      case AST_NODE_TYPES.CallExpression:
        return current;
      case AST_NODE_TYPES.TSAsExpression:
      case AST_NODE_TYPES.TSNonNullExpression:
      case AST_NODE_TYPES.TSSatisfiesExpression:
      case AST_NODE_TYPES.TSTypeAssertion:
        current = current.expression;
        break;
      case AST_NODE_TYPES.LogicalExpression:
        if (current.operator === '&&') {
          return null;
        }
        current = current.left;
        break;
      default:
        return null;
    }
  }
}

export const preferLazyStateInitRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A `useState` initializer that is an expensive call (default `JSON.parse` / `localStorage.getItem` / `sessionStorage.getItem`, or a configured builder) must be wrapped in a function so it runs once on mount, not every render.',
    },
    fixable: 'code',
    schema: [optionSchema],
    messages: {
      lazyInit:
        '`useState({{call}}(...))` runs on every render but React only uses the first value. Wrap it in an initializer function: `useState(() => {{call}}(...))`.',
    },
  },
  defaultOptions: [{ initializers: [...DEFAULT_INITIALIZERS] }],
  create(context, [options]) {
    const initializers = new Set(options.initializers ?? DEFAULT_INITIALIZERS);

    return {
      CallExpression(node): void {
        if (!isUseStateCallee(node.callee)) {
          return;
        }
        const arg = node.arguments[0];
        if (!arg || arg.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }
        const call = unwrapEagerCall(arg);
        if (call === null) {
          return;
        }
        const path = calleePath(call.callee);
        if (path === null) {
          return;
        }
        // Match the written path first, so an explicitly configured
        // `window.localStorage.getItem` still works, then the unprefixed form.
        const matched = initializers.has(path)
          ? path
          : initializers.has(withoutGlobalPrefix(path))
            ? withoutGlobalPrefix(path)
            : null;
        if (matched === null) {
          return;
        }
        const text = context.sourceCode.getText(arg);
        context.report({
          node: call,
          messageId: 'lazyInit',
          data: { call: path },
          fix: (fixer) => fixer.replaceText(arg, `() => ${text}`),
        });
      },
    };
  },
});
