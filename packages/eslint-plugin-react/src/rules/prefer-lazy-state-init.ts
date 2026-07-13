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

/** Dotted callee path (`localStorage.getItem`) for a plain identifier/member chain, else null. */
function calleePath(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    const objectPath = calleePath(node.object);
    return objectPath === null ? null : `${objectPath}.${node.property.name}`;
  }
  return null;
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
        if (!arg || arg.type !== AST_NODE_TYPES.CallExpression) {
          return;
        }
        const path = calleePath(arg.callee);
        if (path === null || !initializers.has(path)) {
          return;
        }
        const text = context.sourceCode.getText(arg);
        context.report({
          node: arg,
          messageId: 'lazyInit',
          data: { call: path },
          fix: (fixer) => fixer.replaceText(arg, `() => ${text}`),
        });
      },
    };
  },
});
