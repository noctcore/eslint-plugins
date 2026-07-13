import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

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
 * `cancelled`/`isMounted`-style flag, no cleanup `return`. It is intentionally
 * conservative (any recognisable guard silences it) so a real finding is almost
 * always genuine. Reported as a suggestion-level warning, not autofixed.
 */

const CANCEL_FLAG_RE =
  /^(cancel|cancelled|canceled|ignore|ignored|ismounted|mounted|active|isactive|stale|disposed|aborted)/i;

const EFFECT_NAMES = new Set(['useEffect', 'useLayoutEffect']);

type EffectFn = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

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

/** A call to `setX(...)` or `dispatch(...)`. */
function isSetterCall(node: TSESTree.Node): node is TSESTree.CallExpression {
  return (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    (/^set[A-Z]/.test(node.callee.name) || node.callee.name === 'dispatch')
  );
}

/** The setter call inside a `.then(cb)` callback, or null. */
function thenCallbackSetter(node: TSESTree.Node): TSESTree.CallExpression | null {
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
      const inner = descendants(arg).find(isSetterCall);
      if (inner) {
        return inner;
      }
    }
  }
  return null;
}

/** True when the effect carries any recognisable cancellation guard. */
function isGuarded(effectFn: EffectFn, nodes: readonly TSESTree.Node[]): boolean {
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

  // A cleanup function returned at the effect's top level.
  if (effectFn.body.type === AST_NODE_TYPES.BlockStatement) {
    const hasCleanup = effectFn.body.body.some(
      (stmt) => stmt.type === AST_NODE_TYPES.ReturnStatement && stmt.argument !== null,
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
      descendants(node.test).some(
        (inner) =>
          inner.type === AST_NODE_TYPES.Identifier && CANCEL_FLAG_RE.test(inner.name),
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

        const nodes = descendants(effectFn);
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
            const setter = thenCallbackSetter(candidate);
            if (setter) {
              offender = setter;
              break;
            }
          }
        }

        if (!offender || isGuarded(effectFn, nodes)) {
          return;
        }

        context.report({ node: offender, messageId: 'missingCancellation' });
      },
    };
  },
});
