import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/** A function of any syntactic form. */
export type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/** True for a function declaration, function expression or arrow function. */
export function isFunctionNode(node: TSESTree.Node): node is FunctionNode {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression
  );
}

/** The nearest function enclosing `node` (not `node` itself), or null at module scope. */
export function enclosingFunction(node: TSESTree.Node): FunctionNode | null {
  // `parent` is null on the Program node at runtime, whatever the types say.
  for (let current = node.parent; current != null; current = current.parent) {
    if (isFunctionNode(current)) {
      return current;
    }
  }
  return null;
}

/** True when `ancestor` is `node` or contains it. */
export function isSelfOrAncestor(ancestor: TSESTree.Node, node: TSESTree.Node): boolean {
  for (let current: TSESTree.Node | undefined = node; current != null; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/** Child keys per node type, from the parser (`context.sourceCode.visitorKeys`). */
export type VisitorKeys = Readonly<Record<string, readonly string[] | undefined>>;

/** True for an AST node (an object with a `type`). */
export function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/**
 * True when any node in the subtree of `root` (inclusive) satisfies
 * `predicate`. Walks the parser's visitor keys, so `parent` back-links are never
 * followed, and stops at the first match.
 *
 * ```ts
 * walkSome(fn.body, context.sourceCode.visitorKeys, (node) => node.type === AST_NODE_TYPES.AwaitExpression);
 * ```
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

/** Calls `visit` on every node in the subtree of `root` (inclusive), over the parser's visitor keys. */
export function forEachDescendant(
  root: TSESTree.Node,
  keys: VisitorKeys,
  visit: (node: TSESTree.Node) => void,
): void {
  walkSome(root, keys, (node) => {
    visit(node);
    return false;
  });
}

export interface CalleePathOptions {
  /** Accept `this` as the root of the chain (`this.auditService.log`). Default false. */
  readonly allowThis?: boolean;
}

/**
 * Dotted path of a callee made of an identifier and non-computed member
 * accesses (`fetch`, `undici.request`, `client.http.get`). With `allowThis`, a
 * chain rooted at `this` also counts (`this.logger.info`). Null for computed
 * access, calls, or any other shape, so callers match conservatively against the
 * returned string only.
 */
export function calleePath(node: TSESTree.Node, options: CalleePathOptions = {}): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (node.type === AST_NODE_TYPES.ThisExpression) {
    return options.allowThis === true ? 'this' : null;
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    const object = calleePath(node.object, options);
    return object === null ? null : `${object}.${node.property.name}`;
  }
  return null;
}

/**
 * The called name of a callee: `redact` for `redact(x)`, `mask` for
 * `utils.mask(x)`, `this.a.mask(x)` and `make().mask(x)`. Null for computed
 * access (`fns[name](x)`) and any other shape. Unlike `calleePath`, only the
 * last segment is checked, so the receiver can be anything.
 */
export function calleeName(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
    ? callee.property.name
    : null;
}

/**
 * Root identifier of a test-runner callee: `it`, `test.concurrent`,
 * `describe.each(table)`, ``test.each`...` ``. Null when the chain does not end
 * at an identifier.
 */
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
