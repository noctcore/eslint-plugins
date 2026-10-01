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

/** True when `ancestor` is `node` or contains it. */
export function isSelfOrAncestor(ancestor: TSESTree.Node, node: TSESTree.Node): boolean {
  // `parent` is null on the Program node at runtime, whatever the types say.
  for (let current: TSESTree.Node | undefined = node; current != null; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/** Root identifier of a runner callee: `it`, `test.concurrent`, `describe.each(table)`, ``test.each`...` ``. */
export function runnerName(callee: TSESTree.Node): string | null {
  let current: TSESTree.Node = callee;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.CallExpression) {
      current = current.callee;
    } else if (current.type === AST_NODE_TYPES.TaggedTemplateExpression) {
      current = current.tag;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : null;
}

/** `x` for `x as T`, `<T>x`, `x satisfies T` and `x!`, else the node itself. */
export function unwrapTypeWrappers(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    current = current.expression;
  }
  return current;
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
