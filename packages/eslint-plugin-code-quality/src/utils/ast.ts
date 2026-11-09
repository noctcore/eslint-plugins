import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

// The AST helpers every plugin needs live in @noctcore/eslint-utils; re-exported
// so the rules keep one import site.
export {
  enclosingFunction,
  isSelfOrAncestor,
  isStaticMemberAccess,
  runnerName,
  unwrapTypeWrappers,
  walkSome,
  type VisitorKeys,
} from '@noctcore/eslint-utils';

/** True for the empty-string literal `''` / `""`. */
export function isEmptyStringLiteral(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal && node.value === '';
}
