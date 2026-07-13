import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'no-effect-derived-state';

type MessageIds = 'derivedState';

/*
 * The "you might not need an effect" anti-pattern: an effect whose only job is to
 * `setState` a value that is purely derived from its own dependencies. That value
 * should be computed during render (or with `useMemo`), not synced through an
 * extra render pass — the effect version is slower, flashes stale UI for a frame,
 * and is a common source of update loops.
 *
 * This rule is deliberately CONSERVATIVE — it fires only on the unambiguous shape:
 *  - a `useEffect`/`useLayoutEffect` with a dependency array;
 *  - a NON-async callback whose body is nothing but `setX(...)` statements;
 *  - every setter argument is a pure expression (no calls, awaits, `new`, JSX,
 *    assignments) whose identifiers all resolve to a dependency;
 *  - at least one argument actually reads a dependency (so constant-init effects
 *    are not flagged).
 * Anything with a branch, a side effect, an await, a cleanup, or an argument that
 * reaches outside the dep array bails out unflagged. Reported as a suggestion.
 */

const EFFECT_NAMES = new Set(['useEffect', 'useLayoutEffect']);

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/** All descendant nodes of `root` (inclusive), never crossing the `parent` back-edge. */
function descendants(root: TSESTree.Node): TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as TSESTree.Node;
    out.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'parent') {
        continue;
      }
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            stack.push(child);
          }
        }
      } else if (isNode(value)) {
        stack.push(value);
      }
    }
  }
  return out;
}

function isUseEffectCallee(callee: TSESTree.Node): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return EFFECT_NAMES.has(callee.name);
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    EFFECT_NAMES.has(callee.property.name)
  );
}

/** Root identifier name of a dep/member chain (`props.count` -> `props`), or null. */
function rootName(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    return rootName(node.object);
  }
  return null;
}

/**
 * True when `node` is a pure, side-effect-free expression whose every value
 * identifier resolves to a root in `roots`. Any unrecognised construct (call,
 * await, new, function, assignment, JSX, ...) returns false — the conservative
 * default that makes the whole rule bail out.
 */
function isPureDerivable(node: TSESTree.Node, roots: ReadonlySet<string>): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.Literal:
      return true;
    case AST_NODE_TYPES.Identifier:
      return roots.has(node.name);
    case AST_NODE_TYPES.TemplateLiteral:
      return node.expressions.every((expr) => isPureDerivable(expr, roots));
    case AST_NODE_TYPES.MemberExpression: {
      const root = rootName(node);
      if (root === null || !roots.has(root)) {
        return false;
      }
      return node.computed ? isPureDerivable(node.property, roots) : true;
    }
    case AST_NODE_TYPES.BinaryExpression:
      return (
        node.left.type !== AST_NODE_TYPES.PrivateIdentifier &&
        isPureDerivable(node.left, roots) &&
        isPureDerivable(node.right, roots)
      );
    case AST_NODE_TYPES.LogicalExpression:
      return isPureDerivable(node.left, roots) && isPureDerivable(node.right, roots);
    case AST_NODE_TYPES.UnaryExpression:
      return isPureDerivable(node.argument, roots);
    case AST_NODE_TYPES.ConditionalExpression:
      return (
        isPureDerivable(node.test, roots) &&
        isPureDerivable(node.consequent, roots) &&
        isPureDerivable(node.alternate, roots)
      );
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
      return isPureDerivable(node.expression, roots);
    case AST_NODE_TYPES.ArrayExpression:
      return node.elements.every(
        (element) =>
          element === null ||
          (element.type === AST_NODE_TYPES.SpreadElement
            ? isPureDerivable(element.argument, roots)
            : isPureDerivable(element, roots)),
      );
    case AST_NODE_TYPES.ObjectExpression:
      return node.properties.every((property) => {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          return isPureDerivable(property.argument, roots);
        }
        if (property.computed && !isPureDerivable(property.key, roots)) {
          return false;
        }
        return isPureDerivable(property.value, roots);
      });
    default:
      return false;
  }
}

export const noEffectDerivedStateRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'An effect whose entire body is `setState` calls with values derived purely from its dependencies is the "you might not need an effect" anti-pattern — compute the value during render (or with `useMemo`) instead.',
    },
    schema: [],
    messages: {
      derivedState:
        'This effect only sets state from values already derivable from its dependencies. Compute the value during render (or with `useMemo`) instead of syncing it in an effect. See the React docs: "You Might Not Need an Effect".',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node): void {
        if (!isUseEffectCallee(node.callee)) {
          return;
        }
        const effectFn = node.arguments[0];
        const depsArg = node.arguments[1];
        if (
          !effectFn ||
          (effectFn.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
            effectFn.type !== AST_NODE_TYPES.FunctionExpression) ||
          effectFn.async ||
          effectFn.body.type !== AST_NODE_TYPES.BlockStatement
        ) {
          return;
        }
        if (!depsArg || depsArg.type !== AST_NODE_TYPES.ArrayExpression) {
          return;
        }

        const body = effectFn.body.body;
        if (body.length === 0) {
          return;
        }

        // Every statement must be a bare `setX(...)` call.
        const setterCalls: TSESTree.CallExpression[] = [];
        for (const stmt of body) {
          if (
            stmt.type !== AST_NODE_TYPES.ExpressionStatement ||
            stmt.expression.type !== AST_NODE_TYPES.CallExpression
          ) {
            return;
          }
          const callee = stmt.expression.callee;
          if (callee.type !== AST_NODE_TYPES.Identifier || !/^set[A-Z]/.test(callee.name)) {
            return;
          }
          setterCalls.push(stmt.expression);
        }

        // Reactive roots the args are allowed to read = the dependency roots.
        const depRoots = new Set<string>();
        for (const dep of depsArg.elements) {
          if (!dep || dep.type === AST_NODE_TYPES.SpreadElement) {
            return;
          }
          const root = rootName(dep);
          if (root === null) {
            return;
          }
          depRoots.add(root);
        }
        if (depRoots.size === 0) {
          return;
        }

        let usesDep = false;
        for (const call of setterCalls) {
          for (const arg of call.arguments) {
            if (arg.type === AST_NODE_TYPES.SpreadElement || !isPureDerivable(arg, depRoots)) {
              return;
            }
            if (descendants(arg).some((n) => n.type === AST_NODE_TYPES.Identifier && depRoots.has(n.name))) {
              usesDep = true;
            }
          }
        }
        if (!usesDep) {
          return;
        }

        context.report({ node: node.callee, messageId: 'derivedState' });
      },
    };
  },
});
