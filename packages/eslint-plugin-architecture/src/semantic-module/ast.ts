/*
 * Ported from @boring-stack-pkg/eslint-plugin-module-boundaries 0.2.0
 * (MIT License, Copyright (c) 2026 the boringstack-xyz/eslint-plugins authors).
 * Provenance: boringstack-xyz/eslint-plugins@1f014dc,
 * eslint-plugin-module-boundaries/src/utils/ast.ts.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

type UnknownRecord = Record<string, unknown>;

export function getDeclarationName(node: TSESTree.Node): string | undefined {
  if ('id' in node) {
    const id = node.id;
    if (isIdentifier(id)) {
      return id.name;
    }
  }
  return undefined;
}

export function getVariableDeclaratorName(declarator: TSESTree.VariableDeclarator): string | undefined {
  return declarator.id.type === AST_NODE_TYPES.Identifier ? declarator.id.name : undefined;
}

type WrapperExpression =
  | TSESTree.TSAsExpression
  | TSESTree.TSTypeAssertion
  | TSESTree.TSNonNullExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSInstantiationExpression;

function isWrapperExpression(expression: TSESTree.Expression): expression is WrapperExpression {
  return (
    expression.type === AST_NODE_TYPES.TSAsExpression ||
    expression.type === AST_NODE_TYPES.TSTypeAssertion ||
    expression.type === AST_NODE_TYPES.TSNonNullExpression ||
    expression.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    expression.type === AST_NODE_TYPES.TSInstantiationExpression
  );
}

/** Strips `as`, `<T>x`, `x!`, `satisfies` and `f<T>` wrappers. */
export function unwrapExpression(expression: TSESTree.Expression): TSESTree.Expression {
  let current = expression;
  while (isWrapperExpression(current)) {
    current = current.expression;
  }
  return current;
}

export function isAmbientDeclaration(node: TSESTree.Node): boolean {
  if ('declare' in node && node.declare === true) {
    return true;
  }
  return node.type === AST_NODE_TYPES.TSModuleDeclaration && node.kind === 'global';
}

export function functionReturnsJsx(
  node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
): boolean {
  if (node.type === AST_NODE_TYPES.ArrowFunctionExpression) {
    if (!node.expression && node.body.type === AST_NODE_TYPES.BlockStatement) {
      return blockReturnsJsx(node.body);
    }
    return containsJsx(node.body);
  }
  return blockReturnsJsx(node.body);
}

function blockReturnsJsx(block: TSESTree.BlockStatement): boolean {
  return containsNode(block, (node) => {
    if (node.type !== AST_NODE_TYPES.ReturnStatement || !node.argument) {
      return false;
    }
    return containsJsx(node.argument);
  });
}

export function containsJsx(node: TSESTree.Node): boolean {
  return containsNode(
    node,
    (candidate) =>
      candidate.type === AST_NODE_TYPES.JSXElement || candidate.type === AST_NODE_TYPES.JSXFragment,
  );
}

const SKIPPED_KEYS: ReadonlySet<string> = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

/** Depth-first search of a subtree for a node matching `predicate`. */
export function containsNode(
  root: TSESTree.Node,
  predicate: (node: TSESTree.Node) => boolean,
): boolean {
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (predicate(current)) {
      return true;
    }
    for (const [key, value] of Object.entries(current as unknown as UnknownRecord)) {
      if (SKIPPED_KEYS.has(key)) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNodeLike(item)) {
            stack.push(item);
          }
        }
        continue;
      }
      if (isNodeLike(value)) {
        stack.push(value);
      }
    }
  }
  return false;
}

function isNodeLike(value: unknown): value is TSESTree.Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as UnknownRecord).type === 'string'
  );
}

function isIdentifier(value: unknown): value is TSESTree.Identifier {
  return isNodeLike(value) && value.type === AST_NODE_TYPES.Identifier;
}
