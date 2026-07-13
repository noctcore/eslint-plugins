import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'context-value-must-be-memoized';

type MessageIds = 'inlineValue';

/*
 * The provider-value memo guard. A context Provider whose `value` is an inline
 * object literal (`<XContext.Provider value={{...}}>`) allocates a fresh
 * reference every render, so every consumer re-renders on every parent render —
 * a hot subtree can re-render dozens of times a second for no reason. The value
 * must be a stable reference (`useMemo`/`useRef`), so this rule flags only the
 * inline-object shape.
 *
 * A "context provider" is matched structurally, without type information:
 *  - `<Foo.Provider ...>` / `<FooContext.Provider ...>` — a JSX member element
 *    whose property is `Provider`;
 *  - `<FooContext ...>` — a bare element whose name ends `Context` (the React 19
 *    context-as-provider form).
 * Custom wrapper components (`<FooProvider value={...}>`) are intentionally NOT
 * matched: the value they forward is memoized at their single call site, and
 * matching every `*Provider`-named element would flag unrelated library
 * providers. Only `.tsx` files are scanned.
 */

/** True when the JSX element name denotes a React context provider. */
function isContextProviderName(name: TSESTree.JSXTagNameExpression): boolean {
  if (name.type === AST_NODE_TYPES.JSXMemberExpression) {
    return (
      name.property.type === AST_NODE_TYPES.JSXIdentifier &&
      name.property.name === 'Provider'
    );
  }
  if (name.type === AST_NODE_TYPES.JSXIdentifier) {
    return name.name.endsWith('Context');
  }
  return false;
}

export const contextValueMustBeMemoizedRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A context Provider `value` must not be an inline object literal — a fresh reference each render re-renders every consumer. Memoize it with `useMemo` and pass the stable reference.',
    },
    schema: [],
    messages: {
      inlineValue:
        'A context Provider `value` is an inline object literal — a fresh reference each render re-renders every consumer. Memoize it with `useMemo` (or hold it in a `useRef`) and pass the stable reference.',
    },
  },
  defaultOptions: [],
  create(context) {
    if (!context.filename.endsWith('.tsx')) {
      return {};
    }
    return {
      JSXOpeningElement(node: TSESTree.JSXOpeningElement): void {
        if (!isContextProviderName(node.name)) {
          return;
        }
        for (const attr of node.attributes) {
          if (
            attr.type !== AST_NODE_TYPES.JSXAttribute ||
            attr.name.type !== AST_NODE_TYPES.JSXIdentifier ||
            attr.name.name !== 'value' ||
            attr.value?.type !== AST_NODE_TYPES.JSXExpressionContainer ||
            attr.value.expression.type !== AST_NODE_TYPES.ObjectExpression
          ) {
            continue;
          }
          context.report({
            node: attr.value.expression,
            messageId: 'inlineValue',
          });
        }
      },
    };
  },
});
