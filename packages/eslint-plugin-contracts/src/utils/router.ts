import { calleePath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/** Router methods whose first argument is a route path. */
export const ROUTE_METHODS: ReadonlySet<string> = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'all',
]);

/** A route method call: `<any receiver>.<method>('<path>', ...chain)`. */
export interface RouteCall {
  readonly method: string;
  /** The path argument: a string literal or a template literal with no expressions. */
  readonly path: TSESTree.StringLiteral | TSESTree.TemplateLiteral;
  /** Every argument after the path, handler included, in source order. */
  readonly chain: readonly TSESTree.CallExpressionArgument[];
}

function isStaticPath(
  node: TSESTree.CallExpressionArgument,
): node is TSESTree.StringLiteral | TSESTree.TemplateLiteral {
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string';
  }
  return node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0;
}

/**
 * The route call `node` makes, or null. Null unless the callee is a non-computed
 * member access whose property is a route method, the first argument is a static
 * path, and at least one argument follows it. The receiver is not inspected.
 */
export function routeCall(node: TSESTree.CallExpression): RouteCall | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    !ROUTE_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  const [path, ...chain] = node.arguments;
  if (path === undefined || !isStaticPath(path) || chain.length === 0) {
    return null;
  }
  return { method: callee.property.name, path, chain };
}

/**
 * The dotted name a chain argument is matched by: the path of an identifier or
 * member reference (`signedInOnly`, `auth.signedIn`), the path of a call's callee
 * (`body(S)` is `body`, `v.body(S)` is `v.body`), null for anything else.
 */
export function middlewarePath(arg: TSESTree.CallExpressionArgument): string | null {
  if (arg.type === AST_NODE_TYPES.CallExpression) {
    return calleePath(arg.callee);
  }
  if (arg.type === AST_NODE_TYPES.Identifier || arg.type === AST_NODE_TYPES.MemberExpression) {
    return calleePath(arg);
  }
  return null;
}
