import { AST_NODE_TYPES, isFunctionNode, type TSESTree } from '@noctcore/eslint-utils';

import { logicalParent } from './ast';

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

/**
 * True when `node` is the value of a once-only initialisation of its target:
 *
 * - `ref.current ??= new X()`, `ref.current ||= new X()`;
 * - `cache ?? new X()`, `cache || new X()`;
 * - `ref.current = new X()` under an `if` whose test reads the same target
 *   (`if (ref.current === null)`), or after an early return that does
 *   (`if (ref.current) return;`).
 */
export function isLazyInit(node: TSESTree.Node, sourceText: (node: TSESTree.Node) => string): boolean {
  const { parent, child } = logicalParent(node);
  if (parent.type === AST_NODE_TYPES.LogicalExpression && parent.operator !== '&&' && parent.right === child) {
    return true;
  }
  if (parent.type !== AST_NODE_TYPES.AssignmentExpression || parent.right !== child) return false;
  if (parent.operator === '??=' || parent.operator === '||=') return true;
  if (parent.operator !== '=') return false;
  const target = sourceText(parent.left);
  for (let current: TSESTree.Node | undefined = parent.parent; current != null; current = current.parent) {
    if (isFunctionNode(current)) break;
    if (current.type === AST_NODE_TYPES.IfStatement && sourceText(current.test).includes(target)) return true;
  }
  return earlyReturnTests(parent).some((test) => sourceText(test).includes(target));
}
