import { unwrapTypeWrappers } from '@noctcore/eslint-utils';
import {
  AST_NODE_TYPES,
  ASTUtils,
  type TSESLint,
  type TSESTree,
} from '@typescript-eslint/utils';

import { ROUTE_METHODS, routeCall, type RouteCall } from './router';

/** The same router seen from two places: its `const` binding, its bare `new Hono()`, or a listed name. */
export type RouterIdentity = TSESLint.Scope.Variable | TSESTree.NewExpression | string;

/** Methods that return the router they were called on, so a chain of them keeps one router. */
export const ROUTER_CHAIN_METHODS: ReadonlySet<string> = new Set([
  ...ROUTE_METHODS,
  'use',
  'basePath',
  'route',
  'on',
  'onError',
  'notFound',
]);

type SourceCode = Readonly<TSESLint.SourceCode>;

function isNewHono(node: TSESTree.Node): node is TSESTree.NewExpression {
  return (
    node.type === AST_NODE_TYPES.NewExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'Hono'
  );
}

function constInit(variable: TSESLint.Scope.Variable): TSESTree.Expression | null {
  const [def] = variable.defs;
  if (variable.defs.length !== 1 || def === undefined || def.type !== 'Variable') {
    return null;
  }
  const declarator = def.node;
  if (
    declarator.parent.type !== AST_NODE_TYPES.VariableDeclaration ||
    declarator.parent.kind !== 'const' ||
    declarator.id.type !== AST_NODE_TYPES.Identifier ||
    declarator.init === null
  ) {
    return null;
  }
  return declarator.init;
}

function resolve(
  start: TSESTree.Node,
  sourceCode: SourceCode,
  routerNames: ReadonlySet<string>,
  visited: Set<TSESLint.Scope.Variable>,
): RouterIdentity | null {
  let node = unwrapTypeWrappers(start);
  while (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    !node.callee.computed &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    ROUTER_CHAIN_METHODS.has(node.callee.property.name)
  ) {
    node = unwrapTypeWrappers(node.callee.object);
  }
  if (isNewHono(node)) {
    return node;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  if (routerNames.has(node.name)) {
    return variable ?? node.name;
  }
  if (variable === null || visited.has(variable)) {
    return null;
  }
  visited.add(variable);
  const init = constInit(variable);
  if (init === null) {
    return null;
  }
  return resolve(init, sourceCode, routerNames, visited) === null ? null : variable;
}

/**
 * The router `node` evaluates to, or null. A router is `new Hono()`, a `const`
 * bound to one (directly or through a chain of router methods), or an identifier
 * named in `routerNames`. Imports, parameters, `let` and `var` bindings and
 * calls on unknown roots are not routers.
 */
export function routerIdentity(
  node: TSESTree.Node,
  sourceCode: SourceCode,
  routerNames: ReadonlySet<string>,
): RouterIdentity | null {
  return resolve(node, sourceCode, routerNames, new Set());
}

/** A route call whose receiver is a known router. */
export interface RouterRouteCall extends RouteCall {
  readonly router: RouterIdentity;
}

/** The route call `node` makes on a known router, or null. */
export function routerRouteCall(
  node: TSESTree.CallExpression,
  sourceCode: SourceCode,
  routerNames: ReadonlySet<string>,
): RouterRouteCall | null {
  const route = routeCall(node);
  if (route === null || node.callee.type !== AST_NODE_TYPES.MemberExpression) {
    return null;
  }
  const router = routerIdentity(node.callee.object, sourceCode, routerNames);
  return router === null ? null : { ...route, router };
}

/** A `<router>.use(...)` call. */
export interface RouterUseCall {
  readonly router: RouterIdentity;
  readonly args: readonly TSESTree.CallExpressionArgument[];
}

/** The `.use(...)` call `node` makes on a known router, or null. */
export function routerUseCall(
  node: TSESTree.CallExpression,
  sourceCode: SourceCode,
  routerNames: ReadonlySet<string>,
): RouterUseCall | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier ||
    callee.property.name !== 'use'
  ) {
    return null;
  }
  const router = routerIdentity(callee.object, sourceCode, routerNames);
  return router === null ? null : { router, args: node.arguments };
}
