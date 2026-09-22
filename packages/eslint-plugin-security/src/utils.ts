import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/*
 * Layout-independent AST helpers shared by this package's rules. Kept
 * dependency-free on purpose, and copied rather than imported from a sibling
 * plugin: each package carries only the helpers it needs so it survives being
 * published on its own.
 */

/**
 * Dotted source text of a call's callee when it is a plain identifier or a chain
 * of member accesses (`fetch`, `undici.request`, `client.http.get`). Returns
 * `null` for computed access, `this`, calls, or any other shape, so callers
 * match conservatively against the returned string only.
 */
export function calleeText(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (callee.type === AST_NODE_TYPES.MemberExpression && !callee.computed) {
    const object = calleeText(callee.object);
    if (object === null || callee.property.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    return `${object}.${callee.property.name}`;
  }
  return null;
}
