import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeText, walk } from '../utils';

const RULE_NAME = 'no-leaky-race-timeout';

type RuleOptions = [];
type MessageIds = 'discardedHandle' | 'unclearedHandle';

/*
 * The hand-rolled timeout
 *
 *   await Promise.race([work, new Promise((_, reject) => setTimeout(reject, ms))]);
 *
 * leaks its timer whenever `work` wins: nothing clears the `setTimeout`, so the
 * timer (and everything its callback closes over) stays alive for the full `ms`,
 * and in Node it keeps the event loop running. Under load that is one pending
 * timer per request (nodejs/node#37683).
 *
 * This flags a global `setTimeout(...)` inside the executor of an inline
 * `new Promise(...)` element of a `Promise.race([...])` array when:
 *   - its handle is discarded (an expression statement, the executor's arrow
 *     body, or the executor's `return`), so it can never be cleared; or
 *   - its handle is stored in a plain variable that no `clearTimeout(handle)`
 *     reaches.
 *
 * A `clearTimeout(handle)` counts when it sits after the race inside the race's
 * own function (a `.finally(...)` chained on the race, a `finally` block, a
 * statement after the `await`), inside the race's array (another racer's
 * `.finally`), in a callback declared in that function (a `cleanup` helper
 * passed to `.finally` later), or anywhere at all when the handle lives outside
 * that function. So only a handle with no clear at all, or cleared only before
 * the race in the same function body, is reported.
 *
 * Any other use of the handle (a member target, an argument, a returned value)
 * is opaque, and the rule stays silent. A `setTimeout` bound locally (an import
 * from `node:timers/promises`, a parameter) is not the global timer and is
 * skipped, as is `AbortSignal.timeout(ms)`, which has no handle to leak.
 */

const TIMER_CALLEES: ReadonlySet<string> = new Set([
  'setTimeout',
  'globalThis.setTimeout',
  'window.setTimeout',
]);

const CLEAR_CALLEES: ReadonlySet<string> = new Set([
  'clearTimeout',
  'clearInterval',
  'globalThis.clearTimeout',
  'globalThis.clearInterval',
  'window.clearTimeout',
  'window.clearInterval',
]);

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

function isFunction(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  );
}

/** The nearest function enclosing `node`, or the Program. */
function enclosingFunction(node: TSESTree.Node): FunctionNode | TSESTree.Program {
  let current = node.parent;
  while (current !== undefined) {
    if (isFunction(current) || current.type === AST_NODE_TYPES.Program) {
      return current;
    }
    current = current.parent;
  }
  throw new Error('unreachable: every node sits under a Program');
}

function contains(outer: TSESTree.Node, inner: TSESTree.Node): boolean {
  return outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];
}

/** Climb past type-only wrappers (`setTimeout(...) as unknown as number`, `x!`). */
function skipTypeWrappers(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.parent !== undefined &&
    (current.parent.type === AST_NODE_TYPES.TSAsExpression ||
      current.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.parent.type === AST_NODE_TYPES.TSTypeAssertion)
  ) {
    current = current.parent;
  }
  return current;
}

type HandleUse =
  | { readonly kind: 'discarded' }
  | { readonly kind: 'variable'; readonly variable: TSESLint.Scope.Variable }
  | { readonly kind: 'opaque' };

/** Where the timer handle returned by `call` goes. */
function handleUse(
  call: TSESTree.CallExpression,
  executor: FunctionNode,
  sourceCode: Readonly<TSESLint.SourceCode>,
): HandleUse {
  const top = skipTypeWrappers(call);
  const parent = top.parent;
  if (parent === undefined) {
    return { kind: 'opaque' };
  }
  if (parent.type === AST_NODE_TYPES.ExpressionStatement) {
    return { kind: 'discarded' };
  }
  // The executor's return value is ignored by the Promise constructor.
  if (parent === executor && executor.body === top) {
    return { kind: 'discarded' };
  }
  if (parent.type === AST_NODE_TYPES.ReturnStatement && enclosingFunction(parent) === executor) {
    return { kind: 'discarded' };
  }
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === top &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    const variable = sourceCode.getDeclaredVariables(parent)[0];
    return variable === undefined ? { kind: 'opaque' } : { kind: 'variable', variable };
  }
  if (
    parent.type === AST_NODE_TYPES.AssignmentExpression &&
    parent.operator === '=' &&
    parent.right === top &&
    parent.left.type === AST_NODE_TYPES.Identifier
  ) {
    const variable = ASTUtils.findVariable(sourceCode.getScope(parent), parent.left);
    return variable === null ? { kind: 'opaque' } : { kind: 'variable', variable };
  }
  return { kind: 'opaque' };
}

/** `clearTimeout(<identifier>)` calls whose argument reads `variable`. */
function clearCalls(variable: TSESLint.Scope.Variable): TSESTree.CallExpression[] {
  const calls: TSESTree.CallExpression[] = [];
  for (const reference of variable.references) {
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (
      parent?.type === AST_NODE_TYPES.CallExpression &&
      parent.arguments[0] === identifier &&
      CLEAR_CALLEES.has(calleeText(parent.callee) ?? '')
    ) {
      calls.push(parent);
    }
  }
  return calls;
}

function isCleared(variable: TSESLint.Scope.Variable, race: TSESTree.CallExpression): boolean {
  const clears = clearCalls(variable);
  if (clears.length === 0) {
    return false;
  }
  const raceFunction = enclosingFunction(race);
  const declaration = variable.defs[0]?.node;
  // A handle owned by an outer scope can be cleared from anywhere; flow is not ours to judge.
  if (declaration === undefined || !contains(raceFunction, declaration)) {
    return true;
  }
  return clears.some(
    (clear) =>
      contains(race, clear) ||
      (contains(raceFunction, clear) &&
        // After the race, or inside a callback (`const stop = () => clearTimeout(t)`)
        // that may run after it: either way the rule cannot prove a leak.
        (clear.range[0] >= race.range[1] || enclosingFunction(clear) !== raceFunction)),
  );
}

/** True when `setTimeout` here is the global timer, not a local binding (an import, a parameter). */
function isGlobalTimer(call: TSESTree.CallExpression, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const callee = call.callee;
  const root =
    callee.type === AST_NODE_TYPES.Identifier
      ? callee
      : callee.type === AST_NODE_TYPES.MemberExpression && callee.object.type === AST_NODE_TYPES.Identifier
        ? callee.object
        : null;
  if (root === null) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(call), root);
  return variable === null || variable.defs.length === 0;
}

/** The executor of an inline `new Promise(<function>)`, if `node` is one. */
function promiseExecutor(node: TSESTree.Node | null): FunctionNode | null {
  if (
    node?.type !== AST_NODE_TYPES.NewExpression ||
    node.callee.type !== AST_NODE_TYPES.Identifier ||
    node.callee.name !== 'Promise'
  ) {
    return null;
  }
  const executor = node.arguments[0];
  return executor !== undefined && isFunction(executor) ? executor : null;
}

export const noLeakyRaceTimeoutRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A `setTimeout` timeout raced with `Promise.race` must be cleared — otherwise the timer outlives the race whenever the other promise wins.',
    },
    schema: [],
    messages: {
      discardedHandle:
        'This `setTimeout` races in `Promise.race` but its handle is discarded, so it can never be cleared and stays pending after the other promise wins. Keep the handle and `clearTimeout` it in a `finally`, or use `AbortSignal.timeout(ms)` instead.',
      unclearedHandle:
        'The `{{name}}` timer raced in `Promise.race` is never cleared after the race, so it stays pending after the other promise wins. Call `clearTimeout({{name}})` in a `finally` (or `.finally(...)` on the race), or use `AbortSignal.timeout(ms)` instead.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;

    function checkExecutor(executor: FunctionNode, race: TSESTree.CallExpression): void {
      walk(executor.body, (node) => {
        if (
          node.type !== AST_NODE_TYPES.CallExpression ||
          !TIMER_CALLEES.has(calleeText(node.callee) ?? '') ||
          !isGlobalTimer(node, sourceCode)
        ) {
          return;
        }
        const use = handleUse(node, executor, sourceCode);
        if (use.kind === 'discarded') {
          context.report({ node, messageId: 'discardedHandle' });
        } else if (use.kind === 'variable' && !isCleared(use.variable, race)) {
          context.report({ node, messageId: 'unclearedHandle', data: { name: use.variable.name } });
        }
      });
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (calleeText(node.callee) !== 'Promise.race') {
          return;
        }
        const racers = node.arguments[0];
        if (racers?.type !== AST_NODE_TYPES.ArrayExpression) {
          return;
        }
        for (const element of racers.elements) {
          const executor = promiseExecutor(element);
          if (executor !== null) {
            checkExecutor(executor, node);
          }
        }
      },
    };
  },
});
