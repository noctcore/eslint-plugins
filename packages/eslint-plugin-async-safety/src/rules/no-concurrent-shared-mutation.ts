import { AST_NODE_TYPES, forEachDescendant, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';

const RULE_NAME = 'no-concurrent-shared-mutation';

type RuleOptions = [];
type MessageIds = 'concurrentMutation';

/*
 * `Promise.all(arr.map(async …))` starts every callback concurrently; their
 * awaits interleave. A read-modify-write of an OUTER-scope binding inside such a
 * callback can lose updates, but only when an `await` sits BETWEEN the read and
 * the write: `total += await size(x)` reads `total`, suspends, then writes a
 * value computed from the stale read. JavaScript runs each synchronous step to
 * completion, so `await save(x); done++;` and `const n = await size(x); total += n;`
 * read and write in one step and can never interleave; they are not reported.
 *
 * Conservative, syntactic, no types:
 *   - fires only for the inline `Promise.all(<...>.map(async …))` /
 *     `.flatMap` / `.forEach` shape whose callback is async AND awaits;
 *   - flags only direct binding read-modify-writes whose right-hand side awaits
 *     after the read: compound assignment (`x += await …`) and self-referential
 *     `x = x + await …` / `x = await f(x)`. `x++` has no await inside it and a
 *     plain overwrite is last-write-wins; neither is flagged;
 *   - `arr.push(...)`, `map.set(...)`, and `results[i] = …` are NOT flagged: method
 *     calls and distinct-index writes are order-tolerant, not lost updates;
 *   - the mutated binding must resolve to a variable declared OUTSIDE the callback.
 * No fix — accumulate into an array and reduce after the `Promise.all`, or update atomically.
 */
const CONCURRENT_ITERATORS: ReadonlySet<string> = new Set(['map', 'flatMap', 'forEach']);

type AsyncCallback = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

function isPromiseConcurrency(callee: TSESTree.Node): boolean {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'Promise' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    (callee.property.name === 'all' || callee.property.name === 'allSettled')
  );
}

/** The async callback of a `.map`/`.flatMap`/`.forEach` call, if that is the call's shape. */
function asyncIterationCallback(node: TSESTree.Node): AsyncCallback | null {
  if (
    node.type !== AST_NODE_TYPES.CallExpression ||
    node.callee.type !== AST_NODE_TYPES.MemberExpression ||
    node.callee.computed ||
    node.callee.property.type !== AST_NODE_TYPES.Identifier ||
    !CONCURRENT_ITERATORS.has(node.callee.property.name)
  ) {
    return null;
  }
  const callback = node.arguments[node.arguments.length - 1];
  if (
    callback !== undefined &&
    (callback.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      callback.type === AST_NODE_TYPES.FunctionExpression) &&
    callback.async
  ) {
    return callback;
  }
  return null;
}

function isFunctionNode(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
}

/** Walk `node` without descending into nested functions (their awaits run elsewhere). */
function walkSameFunction(node: TSESTree.Node, visit: (node: TSESTree.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (
        typeof child === 'object' &&
        child !== null &&
        typeof (child as { type?: unknown }).type === 'string' &&
        !isFunctionNode(child as TSESTree.Node)
      ) {
        walkSameFunction(child as TSESTree.Node, visit);
      }
    }
  }
}

/** End offsets of every `await` evaluated by `node` itself. */
function awaitEnds(node: TSESTree.Node): number[] {
  const ends: number[] = [];
  walkSameFunction(node, (inner) => {
    if (inner.type === AST_NODE_TYPES.AwaitExpression) {
      ends.push(inner.range[1]);
    }
  });
  return ends;
}

/**
 * `name` is read inside `node` before one of its awaits settles. Source order is
 * evaluation order for the operands of one expression, so a read that starts
 * before an await ends happened before the callback suspended there.
 */
function readsBeforeAwait(node: TSESTree.Node, name: string): boolean {
  const ends = awaitEnds(node);
  if (ends.length === 0) {
    return false;
  }
  const lastEnd = Math.max(...ends);
  let found = false;
  walkSameFunction(node, (inner) => {
    if (inner.type === AST_NODE_TYPES.Identifier && inner.name === name && inner.range[0] < lastEnd) {
      found = true;
    }
  });
  return found;
}

function resolveVariable(
  scope: TSESLint.Scope.Scope,
  name: string,
): TSESLint.Scope.Variable | null {
  for (let current: TSESLint.Scope.Scope | null = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) {
      return variable;
    }
  }
  return null;
}

export const noConcurrentSharedMutationRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A read-modify-write of an outer-scope binding that awaits between the read and the write, inside a concurrent `Promise.all(arr.map(async …))` callback, can lose updates.',
    },
    schema: [],
    messages: {
      concurrentMutation:
        '`{{name}}` is read, then written after an `await` inside a concurrent `Promise.all` callback, so another iteration can write it in between and that update is lost. Collect results into an array and reduce after the `Promise.all`, or update atomically.',
    },
  },
  defaultOptions: [],
  create(context) {
    const reported = new Set<TSESTree.Node>();

    /** The identifier is written AND resolves to a binding declared outside `callback`. */
    function isOuterWrite(id: TSESTree.Identifier, callback: AsyncCallback): boolean {
      const variable = resolveVariable(context.sourceCode.getScope(id), id.name);
      const def = variable?.defs[0];
      if (def === undefined) {
        return false;
      }
      const defRange = def.name.range;
      const inside = defRange[0] >= callback.range[0] && defRange[1] <= callback.range[1];
      return !inside;
    }

    function checkCallback(callback: AsyncCallback): void {
      forEachDescendant(callback, context.sourceCode.visitorKeys, (node) => {
        if (node.type !== AST_NODE_TYPES.AssignmentExpression || node.left.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        const left = node.left;
        // `x op= rhs` reads `x` before evaluating `rhs`, so any await in `rhs` splits the read from the write.
        const compound = node.operator !== '=' && awaitEnds(node.right).length > 0;
        const selfReferential = node.operator === '=' && readsBeforeAwait(node.right, left.name);
        if ((compound || selfReferential) && !reported.has(left) && isOuterWrite(left, callback)) {
          reported.add(left);
          context.report({ node: left, messageId: 'concurrentMutation', data: { name: left.name } });
        }
      });
    }

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (!isPromiseConcurrency(node.callee)) {
          return;
        }
        const arg = node.arguments[0];
        if (arg === undefined || arg.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }
        forEachDescendant(arg, context.sourceCode.visitorKeys, (inner) => {
          const callback = asyncIterationCallback(inner);
          if (callback !== null) {
            checkCallback(callback);
          }
        });
      },
    };
  },
});
