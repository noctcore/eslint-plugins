import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { isHookName } from '../utils';

const RULE_NAME = 'no-jsx-in-hooks';

type MessageIds = 'jsxInHook';

/*
 * A `use*`-named function that returns JSX is a component wearing a hook costume.
 * Hooks return data and handlers; components return markup. Mislabelling one as
 * the other breaks the rules-of-hooks mental model (a "hook" that must be called
 * as `<useThing />`) and defeats every convention keyed off the `use*` prefix.
 * Rename it to a PascalCase component, or return values instead of elements.
 *
 * Matched syntactically: a function whose declared name is a hook name (`useX`)
 * whose own body returns JSX (directly, or via a ternary/`&&`). Returns inside
 * NESTED functions (render callbacks, `.map` bodies) belong to those functions,
 * not the hook, and are not attributed to it.
 */

type FnNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/** True when an expression is — or, unwrapped through ternary/logical/sequence, contains — top-level JSX. */
function isJsxExpression(node: TSESTree.Node | null | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.type) {
    case AST_NODE_TYPES.JSXElement:
    case AST_NODE_TYPES.JSXFragment:
      return true;
    case AST_NODE_TYPES.ConditionalExpression:
      return isJsxExpression(node.consequent) || isJsxExpression(node.alternate);
    case AST_NODE_TYPES.LogicalExpression:
      return isJsxExpression(node.left) || isJsxExpression(node.right);
    case AST_NODE_TYPES.SequenceExpression:
      return isJsxExpression(node.expressions[node.expressions.length - 1]);
    default:
      return false;
  }
}

function isFunctionNode(node: TSESTree.Node): node is FnNode {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  );
}

/** Nearest enclosing function of a node, or null at module scope. */
function enclosingFunction(node: TSESTree.Node): FnNode | null {
  let current = node.parent;
  while (current) {
    if (isFunctionNode(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Declared name of a function, from its own id or the variable it is assigned to. */
function functionName(fn: FnNode): string | undefined {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration) {
    return fn.id?.name;
  }
  if (fn.type === AST_NODE_TYPES.FunctionExpression && fn.id) {
    return fn.id.name;
  }
  const parent = fn.parent;
  if (
    parent?.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  return undefined;
}

/** The node the report points at: the function's name identifier when available. */
function reportTarget(fn: FnNode): TSESTree.Node {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration && fn.id) {
    return fn.id;
  }
  if (fn.type === AST_NODE_TYPES.FunctionExpression && fn.id) {
    return fn.id;
  }
  const parent = fn.parent;
  if (parent?.type === AST_NODE_TYPES.VariableDeclarator) {
    return parent.id;
  }
  return fn;
}

export const noJsxInHooksRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A `use*`-named function must not return JSX — that is a component wearing a hook costume. Rename it to a PascalCase component, or return values instead of elements.',
    },
    schema: [],
    messages: {
      jsxInHook:
        '`{{name}}` is named like a hook but returns JSX. Hooks return data and handlers, not markup — rename it to a PascalCase component, or return values instead of elements.',
    },
  },
  defaultOptions: [],
  create(context) {
    const reported = new Set<FnNode>();

    function flag(fn: FnNode): void {
      if (reported.has(fn)) {
        return;
      }
      const name = functionName(fn);
      if (name === undefined || !isHookName(name)) {
        return;
      }
      reported.add(fn);
      context.report({ node: reportTarget(fn), messageId: 'jsxInHook', data: { name } });
    }

    return {
      // `return <JSX/>` (or `return cond ? <A/> : <B/>`) inside a hook-named function.
      ReturnStatement(node): void {
        if (!node.argument || !isJsxExpression(node.argument)) {
          return;
        }
        const fn = enclosingFunction(node);
        if (fn) {
          flag(fn);
        }
      },
      // Concise-body arrow: `const useX = () => <div/>`.
      ArrowFunctionExpression(node): void {
        if (node.body.type !== AST_NODE_TYPES.BlockStatement && isJsxExpression(node.body)) {
          flag(node);
        }
      },
    };
  },
});
