import { calleeName, calleePath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

// The AST helpers every plugin needs live in @noctcore/eslint-utils; re-exported
// so the rules keep one import site.
export {
  calleeName,
  calleePath,
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

/**
 * The text a rule's callee regexes are matched against: the dotted path of a
 * chain rooted at an identifier (`assert`, `assert.strict.equal`), else `.name`
 * for a member call on anything else (`request(app).get('/').expect`), else null.
 */
export function calleeMatchText(callee: TSESTree.Node): string | null {
  const path = calleePath(callee);
  if (path !== null) {
    return path;
  }
  const name = calleeName(callee);
  return name !== null && callee.type === AST_NODE_TYPES.MemberExpression ? `.${name}` : null;
}
