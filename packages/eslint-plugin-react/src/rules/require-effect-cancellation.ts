import { forEachDescendant, walkSome, type VisitorKeys } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { stateSetterSource } from '../utils';

const RULE_NAME = 'require-effect-cancellation';

type MessageIds = 'missingCancellation';

/*
 * A state update that runs after an async step inside an effect, with nothing to
 * cancel it, is the classic "setState after unmount / stale response" bug: if the
 * effect re-runs (deps change) or the component unmounts before the promise
 * settles, the update lands on a dead effect and can clobber fresh state.
 *
 * This rule flags exactly that shape — an `await` (or a `.then(cb)`) inside a
 * `useEffect` / `useLayoutEffect` callback, followed by a `setState`/`dispatch`
 * — and ONLY when the effect has no cancellation guard: no `AbortController`, no
 * `cancelled`/`isMounted`-style flag, no cleanup `return` that sets a flag or
 * cancels. A cleanup that only clears a timer or removes a listener is not one. It is intentionally
 * conservative (any recognisable guard silences it) so a real finding is almost
 * always genuine. Not autofixed.
 */

const CANCEL_FLAG_RE =
  /^(cancel|cancelled|canceled|ignore|ignored|ismounted|mounted|active|isactive|stale|disposed|aborted)/i;

const EFFECT_NAMES = new Set(['useEffect', 'useLayoutEffect']);

type EffectFn = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

/** Every node in the subtree of `root` (inclusive), in source order. */
function nodesIn(root: TSESTree.Node, keys: VisitorKeys): TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  forEachDescendant(root, keys, (node) => {
    out.push(node);
  });
  return out.sort((a, b) => a.range[0] - b.range[0]);
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

type SetterPredicate = (node: TSESTree.Node) => node is TSESTree.CallExpression;

/** The setter call inside a `.then(cb)` callback, or null. */
function thenCallbackSetter(
  node: TSESTree.Node,
  isSetterCall: SetterPredicate,
  keys: VisitorKeys,
): TSESTree.CallExpression | null {
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    callee.property.name !== 'then'
  ) {
    return null;
  }
  for (const arg of node.arguments) {
    if (
      arg.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      arg.type === AST_NODE_TYPES.FunctionExpression
    ) {
      const inner = nodesIn(arg, keys).find(isSetterCall);
      if (inner) {
        return inner;
      }
    }
  }
  return null;
}

const CANCEL_CALL_RE = /^(abort|cancel|dispose|ignore)/i;

/**
 * True when a returned cleanup can stop the pending update: it sets something
 * (`cancelled = true`, `mounted.current = false`) or calls an abort or cancel
 * method. A cleanup that only clears a timer or removes a listener
 * (`return () => clearInterval(id)`) is unrelated to the async step. A returned
 * value the rule cannot see into (`return unsubscribe`) still counts.
 */
function isCancellingCleanup(returned: TSESTree.Expression, keys: VisitorKeys): boolean {
  if (
    returned.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
    returned.type !== AST_NODE_TYPES.FunctionExpression
  ) {
    return true;
  }
  return walkSome(returned.body, keys, (node) => {
    if (node.type === AST_NODE_TYPES.AssignmentExpression) {
      return true;
    }
    if (node.type !== AST_NODE_TYPES.CallExpression) {
      return false;
    }
    const callee = node.callee;
    const name =
      callee.type === AST_NODE_TYPES.Identifier
        ? callee.name
        : callee.type === AST_NODE_TYPES.MemberExpression &&
            !callee.computed &&
            callee.property.type === AST_NODE_TYPES.Identifier
          ? callee.property.name
          : '';
    return CANCEL_CALL_RE.test(name);
  });
}

/** True when the effect carries any recognisable cancellation guard. */
function isGuarded(effectFn: EffectFn, nodes: readonly TSESTree.Node[], keys: VisitorKeys): boolean {
  // AbortController / AbortSignal usage.
  const hasAbort = nodes.some(
    (node) =>
      (node.type === AST_NODE_TYPES.Identifier &&
        (node.name === 'AbortController' || node.name === 'AbortSignal')) ||
      (node.type === AST_NODE_TYPES.MemberExpression &&
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        (node.property.name === 'signal' ||
          node.property.name === 'aborted' ||
          node.property.name === 'abort')),
  );
  if (hasAbort) {
    return true;
  }

  // A cleanup returned at the effect's top level that can stop the update.
  if (effectFn.body.type === AST_NODE_TYPES.BlockStatement) {
    const hasCleanup = effectFn.body.body.some(
      (stmt) =>
        stmt.type === AST_NODE_TYPES.ReturnStatement &&
        stmt.argument !== null &&
        isCancellingCleanup(stmt.argument, keys),
    );
    if (hasCleanup) {
      return true;
    }
  }

  // A cancel-ish boolean flag that is later read.
  const idCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === AST_NODE_TYPES.Identifier) {
      idCounts.set(node.name, (idCounts.get(node.name) ?? 0) + 1);
    }
  }
  const hasFlag = nodes.some(
    (node) =>
      node.type === AST_NODE_TYPES.VariableDeclarator &&
      node.id.type === AST_NODE_TYPES.Identifier &&
      node.init?.type === AST_NODE_TYPES.Literal &&
      typeof node.init.value === 'boolean' &&
      CANCEL_FLAG_RE.test(node.id.name) &&
      (idCounts.get(node.id.name) ?? 0) > 1,
  );
  if (hasFlag) {
    return true;
  }

  // An `if` whose test references a cancel-ish name (guards a ref-based flag too).
  return nodes.some(
    (node) =>
      node.type === AST_NODE_TYPES.IfStatement &&
      walkSome(
        node.test,
        keys,
        (inner) => inner.type === AST_NODE_TYPES.Identifier && CANCEL_FLAG_RE.test(inner.name),
      ),
  );
}

export const requireEffectCancellationRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A `setState`/`dispatch` that runs after an `await` or `.then()` inside a `useEffect` must be guarded against a unmounted/re-run effect (AbortController, a cancelled flag, or a cleanup return).',
    },
    schema: [],
    messages: {
      missingCancellation:
        'This state update runs after an async step in the effect, but nothing cancels it. If the effect re-runs or the component unmounts before the promise settles, it updates stale state. Guard it with an AbortController or a `cancelled` flag, or return a cleanup.',
    },
  },
  defaultOptions: [],
  create(context) {
    /**
     * A call of a `useState` setter or a `useReducer` dispatch. A function from
     * a context, a prop or an import, and `setTimeout` / `setInterval`, are not
     * component state.
     */
    const isSetterCall: SetterPredicate = (node): node is TSESTree.CallExpression =>
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.Identifier &&
      stateSetterSource(node.callee, context.sourceCode.getScope(node.callee)) !== null;

    return {
      CallExpression(node): void {
        if (!isUseEffectCallee(node.callee)) {
          return;
        }
        const effectFn = node.arguments[0];
        if (
          !effectFn ||
          (effectFn.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
            effectFn.type !== AST_NODE_TYPES.FunctionExpression)
        ) {
          return;
        }

        const keys = context.sourceCode.visitorKeys;
        const nodes = nodesIn(effectFn, keys);
        const setterCalls = nodes.filter(isSetterCall);
        if (setterCalls.length === 0) {
          return;
        }

        let offender: TSESTree.Node | null = null;

        // `await` shape: a setter that appears after the first await, in textual order.
        const awaits = nodes.filter((n) => n.type === AST_NODE_TYPES.AwaitExpression);
        if (awaits.length > 0) {
          const firstAwaitStart = Math.min(...awaits.map((a) => a.range[0]));
          offender = setterCalls.find((s) => s.range[0] > firstAwaitStart) ?? null;
        }

        // `.then(cb)` shape: a setter inside a then-callback.
        if (!offender) {
          for (const candidate of nodes) {
            const setter = thenCallbackSetter(candidate, isSetterCall, keys);
            if (setter) {
              offender = setter;
              break;
            }
          }
        }

        if (!offender || isGuarded(effectFn, nodes, keys)) {
          return;
        }

        context.report({ node: offender, messageId: 'missingCancellation' });
      },
    };
  },
});
