import { AST_NODE_TYPES, isFunctionNode, type TSESTree } from '@noctcore/eslint-utils';

import { chainKey, logicalParent, unwrap } from './ast';

/** True when an `if` consequent always leaves: `return`, or a block that ends in one. */
function returns(statement: TSESTree.Statement): boolean {
  if (statement.type === AST_NODE_TYPES.ReturnStatement) return true;
  if (statement.type !== AST_NODE_TYPES.BlockStatement) return false;
  const last = statement.body[statement.body.length - 1];
  return last?.type === AST_NODE_TYPES.ReturnStatement;
}

/**
 * The tests of the early returns that run before `node` in its own function:
 * `if (done) return;` written above it in the same block or an enclosing one.
 * The search stops at the nearest function.
 */
export function earlyReturnTests(node: TSESTree.Node): TSESTree.Expression[] {
  const tests: TSESTree.Expression[] = [];
  let child: TSESTree.Node = node;
  for (let current = node.parent; current != null; current = current.parent) {
    if (current.type === AST_NODE_TYPES.BlockStatement) {
      for (const statement of current.body) {
        if (statement === child) break;
        if (statement.type === AST_NODE_TYPES.IfStatement && returns(statement.consequent)) {
          tests.push(statement.test);
        }
      }
    }
    if (isFunctionNode(current)) break;
    child = current;
  }
  return tests;
}

function isNullish(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  return (
    (inner.type === AST_NODE_TYPES.Literal && inner.value === null) ||
    (inner.type === AST_NODE_TYPES.Identifier && inner.name === 'undefined')
  );
}

/** `'set'` / `'unset'` for `t == null`, `t !== undefined` and the like on `target`, else null. */
function comparison(node: TSESTree.Node, target: string): 'set' | 'unset' | null {
  if (node.type !== AST_NODE_TYPES.BinaryExpression) return null;
  const { left, right, operator } = node;
  const other = isNullish(right) ? left : isNullish(left) ? right : null;
  if (other === null || chainKey(other) !== target) return null;
  if (operator === '==' || operator === '===') return 'unset';
  if (operator === '!=' || operator === '!==') return 'set';
  return null;
}

/** True when `test` is true only while `target` is unset (`!t`, `t === null`, `!t && ready`). */
function onlyWhenUnset(test: TSESTree.Node, target: string): boolean {
  const node = unwrap(test);
  if (node.type === AST_NODE_TYPES.UnaryExpression && node.operator === '!') {
    return firesWhenSet(node.argument, target);
  }
  if (node.type === AST_NODE_TYPES.LogicalExpression) {
    if (node.operator === '&&') return onlyWhenUnset(node.left, target) || onlyWhenUnset(node.right, target);
    if (node.operator === '||') return onlyWhenUnset(node.left, target) && onlyWhenUnset(node.right, target);
    return false;
  }
  return comparison(node, target) === 'unset';
}

/** True when `test` is true whenever `target` is set (`t`, `t != null`, `t || paused`). */
function firesWhenSet(test: TSESTree.Node, target: string): boolean {
  const node = unwrap(test);
  if (chainKey(node) === target) return true;
  if (node.type === AST_NODE_TYPES.UnaryExpression && node.operator === '!') {
    return onlyWhenUnset(node.argument, target);
  }
  if (node.type === AST_NODE_TYPES.LogicalExpression) {
    if (node.operator === '||') return firesWhenSet(node.left, target) || firesWhenSet(node.right, target);
    if (node.operator === '&&') return firesWhenSet(node.left, target) && firesWhenSet(node.right, target);
    return false;
  }
  return comparison(node, target) === 'set';
}

/** True when `node` sits in a branch of `statement` that runs only while `target` is unset. */
function inUnsetBranch(statement: TSESTree.IfStatement, node: TSESTree.Node, target: string): boolean {
  const within = (branch: TSESTree.Node | null): boolean =>
    branch !== null && node.range[0] >= branch.range[0] && node.range[1] <= branch.range[1];
  if (within(statement.consequent)) return onlyWhenUnset(statement.test, target);
  if (within(statement.alternate)) return firesWhenSet(statement.test, target);
  return false;
}

/**
 * True when `node` is the value of a once-only initialisation of its target,
 * compared as a whole identifier or member chain, with the guard's polarity
 * checked:
 *
 * - `ref.current ??= new X()`, `ref.current ||= new X()`;
 * - `ref.current = ref.current ?? new X()` (the result goes back to the left side);
 * - `ref.current = new X()` in a branch that runs only while the target is unset
 *   (`if (ref.current === null)`, `if (!ref.current)`), or after an early return
 *   that fires whenever it is set (`if (ref.current) return;`).
 */
export function isLazyInit(node: TSESTree.Node): boolean {
  const { parent, child } = logicalParent(node);
  if (parent.type === AST_NODE_TYPES.LogicalExpression && parent.operator !== '&&' && parent.right === child) {
    const read = chainKey(parent.left);
    const assignment = logicalParent(parent).parent;
    return (
      read !== null &&
      assignment.type === AST_NODE_TYPES.AssignmentExpression &&
      assignment.operator === '=' &&
      chainKey(assignment.left) === read
    );
  }
  if (parent.type !== AST_NODE_TYPES.AssignmentExpression || parent.right !== child) return false;
  if (parent.operator === '??=' || parent.operator === '||=') return true;
  if (parent.operator !== '=') return false;
  const target = chainKey(parent.left);
  if (target === null) return false;
  for (let current: TSESTree.Node | undefined = parent.parent; current != null; current = current.parent) {
    if (isFunctionNode(current)) break;
    if (current.type === AST_NODE_TYPES.IfStatement && inUnsetBranch(current, parent, target)) return true;
  }
  return earlyReturnTests(parent).some((test) => firesWhenSet(test, target));
}
