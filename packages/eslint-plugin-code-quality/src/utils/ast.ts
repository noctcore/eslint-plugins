import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/** True for the empty-string literal `''` / `""`. */
export function isEmptyStringLiteral(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal && node.value === '';
}

/**
 * True when `node` is a member access of `objectName.propertyName`, matching
 * both the dot form (`process.env`) and the computed string-literal form
 * (`process['env']`) so a computed access cannot bypass the check.
 */
export function isStaticMemberAccess(
  node: TSESTree.Node,
  objectName: string,
  propertyName: string,
): boolean {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.object.type !== AST_NODE_TYPES.Identifier ||
    node.object.name !== objectName
  ) {
    return false;
  }
  if (node.computed) {
    return node.property.type === AST_NODE_TYPES.Literal && node.property.value === propertyName;
  }
  return node.property.type === AST_NODE_TYPES.Identifier && node.property.name === propertyName;
}

/** Child keys per node type, from the parser (`context.sourceCode.visitorKeys`). */
export type VisitorKeys = Readonly<Record<string, readonly string[] | undefined>>;

function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/**
 * True when any node in the subtree satisfies `predicate`. Walks the parser's
 * visitor keys, so `parent` back-links are never followed.
 */
export function walkSome(
  root: TSESTree.Node,
  keys: VisitorKeys,
  predicate: (node: TSESTree.Node) => boolean,
): boolean {
  const stack: TSESTree.Node[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (predicate(node)) {
      return true;
    }
    for (const key of keys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key);
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
  return false;
}
