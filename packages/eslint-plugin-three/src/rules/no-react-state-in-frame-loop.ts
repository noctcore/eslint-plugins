import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, FrameLoops, isHookCall, skipFile } from '../utils/ast';
import { earlyReturnTests } from '../utils/guards';
import { extraModulesSchema, readThreeImports } from '../utils/imports';

const RULE_NAME = 'no-react-state-in-frame-loop';

export interface NoReactStateInFrameLoopOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
}

type RuleOptions = [NoReactStateInFrameLoopOptions];
type MessageIds = 'stateInFrameLoop';

/*
 * A React state setter schedules a render of the component and its subtree.
 * Called from a frame loop it does that 60 to 120 times a second, routing
 * every animated value through React's reconciler instead of writing it to
 * the object, which is what R3F's own docs call out as the first pitfall.
 *
 * Reported: a call to the setter of `useState` or the dispatch of
 * `useReducer` (resolved through scope, so a same-named function from
 * elsewhere does not count), made unconditionally inside a frame loop.
 *
 * Not reported: a call under an `if`, a `? :`, a `&&` / `||` / `??` or a
 * `switch` case, or after an early return (`if (done) return;`), the usual shape of a one-off transition (`if (t > 2 &&
 * !done) setDone(true)`). Store setters (zustand `set`, signals) are not React
 * state and are left alone.
 */

const STATE_HOOKS = new Set(['useState', 'useReducer']);

/** True when `name` resolves to the second element of a `useState` / `useReducer` tuple. */
function isStateSetter(scope: TSESLint.Scope.Scope, name: string): boolean {
  for (let current: TSESLint.Scope.Scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable === undefined) continue;
    const definition = variable.defs[0];
    if (definition?.node.type !== AST_NODE_TYPES.VariableDeclarator) return false;
    const declarator = definition.node;
    if (declarator.id.type !== AST_NODE_TYPES.ArrayPattern) return false;
    const setter = declarator.id.elements[1];
    if (setter?.type !== AST_NODE_TYPES.Identifier || setter.name !== name) return false;
    return declarator.init !== null && isHookCall(declarator.init, STATE_HOOKS);
  }
  return false;
}

/** True when `node` runs only on some frames: it sits in a branch between itself and `loop`. */
function isConditional(node: TSESTree.Node, loop: TSESTree.Node): boolean {
  let child: TSESTree.Node = node;
  for (let current = node.parent; current != null && current !== loop; current = current.parent) {
    switch (current.type) {
      case AST_NODE_TYPES.IfStatement:
        if (current.test !== child) return true;
        break;
      case AST_NODE_TYPES.ConditionalExpression:
        if (current.test !== child) return true;
        break;
      case AST_NODE_TYPES.LogicalExpression:
        if (current.right === child) return true;
        break;
      case AST_NODE_TYPES.SwitchCase:
      case AST_NODE_TYPES.CatchClause:
        return true;
      default:
        break;
    }
    child = current;
  }
  return false;
}

export const noReactStateInFrameLoopRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling a React state setter unconditionally inside a frame loop (`useFrame`, `setAnimationLoop`, a self-scheduling `requestAnimationFrame` function).',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema, extraModules: extraModulesSchema },
      },
    ],
    messages: {
      stateInFrameLoop:
        '`{{name}}()` re-renders the component on every frame. Keep per-frame values in a ref and write them to the object directly (`ref.current.rotation.y += delta`).',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    const program = context.sourceCode.ast;
    const imports = readThreeImports(program);
    const loops = new FrameLoops(context.sourceCode, imports);
    if (loops.size === 0) return {};

    return {
      CallExpression(node): void {
        if (node.callee.type !== AST_NODE_TYPES.Identifier) return;
        const loop = loops.enclosingLoop(node);
        if (loop === null || isConditional(node, loop) || earlyReturnTests(node).length > 0) return;
        if (!isStateSetter(context.sourceCode.getScope(node), node.callee.name)) return;
        context.report({ node, messageId: 'stateInFrameLoop', data: { name: node.callee.name } });
      },
    };
  },
});
