import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { walk } from '../utils';

const RULE_NAME = 'no-concurrent-shared-mutation';

type RuleOptions = [];
type MessageIds = 'concurrentMutation';

/*
 * `Promise.all(arr.map(async …))` starts every callback concurrently; their
 * awaits interleave. A read-modify-write of an OUTER-scope binding inside such a
 * callback — `total = total + await x`, `total += …`, `count++` — can lose
 * updates: two iterations read the same value and one overwrites the other.
 *
 * Conservative, syntactic, no types:
 *   - fires only for the inline `Promise.all(<...>.map(async …))` /
 *     `.flatMap` / `.forEach` shape whose callback is async AND awaits;
 *   - flags only direct binding read-modify-writes: compound assignment (`+=`),
 *     self-referential `x = x + …`, and `x++` — a plain overwrite is not flagged;
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

function containsAwait(node: TSESTree.Node): boolean {
  let found = false;
  walk(node, (inner) => {
    if (inner.type === AST_NODE_TYPES.AwaitExpression) {
      found = true;
    }
  });
  return found;
}

function referencedNames(node: TSESTree.Node): Set<string> {
  const names = new Set<string>();
  walk(node, (inner) => {
    if (inner.type === AST_NODE_TYPES.Identifier) {
      names.add(inner.name);
    }
  });
  return names;
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
        'A read-modify-write of an outer-scope binding inside a concurrent `Promise.all(arr.map(async …))` callback can lose updates.',
    },
    schema: [],
    messages: {
      concurrentMutation:
        '`{{name}}` is read-modified-written inside a concurrent `Promise.all` callback — interleaved iterations can lose updates. Collect results into an array and reduce after the `Promise.all`, or update atomically.',
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
      if (!containsAwait(callback)) {
        return;
      }
      walk(callback, (node) => {
        if (node.type === AST_NODE_TYPES.UpdateExpression) {
          const arg = node.argument;
          if (arg.type === AST_NODE_TYPES.Identifier && !reported.has(arg) && isOuterWrite(arg, callback)) {
            reported.add(arg);
            context.report({ node: arg, messageId: 'concurrentMutation', data: { name: arg.name } });
          }
          return;
        }
        if (node.type === AST_NODE_TYPES.AssignmentExpression && node.left.type === AST_NODE_TYPES.Identifier) {
          const left = node.left;
          const compound = node.operator !== '=';
          const selfReferential = node.operator === '=' && referencedNames(node.right).has(left.name);
          if ((compound || selfReferential) && !reported.has(left) && isOuterWrite(left, callback)) {
            reported.add(left);
            context.report({ node: left, messageId: 'concurrentMutation', data: { name: left.name } });
          }
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
        walk(arg, (inner) => {
          const callback = asyncIterationCallback(inner);
          if (callback !== null) {
            checkCallback(callback);
          }
        });
      },
    };
  },
});
