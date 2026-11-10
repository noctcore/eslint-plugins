import { calleePath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/** The name of a non-computed `.name` member or a `name:` / `'name':` object key. */
export function staticName(
  node: TSESTree.Expression | TSESTree.PrivateIdentifier | TSESTree.PropertyName,
  computed: boolean,
): string | undefined {
  if (!computed && node.type === AST_NODE_TYPES.Identifier) return node.name;
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') return node.value;
  return undefined;
}

/**
 * The last segment of a callee path: `useEffect` for `useEffect(...)` and
 * `React.useEffect(...)`, `mutate` for `this.save.mutate(...)`. Undefined for
 * computed access and any other shape.
 */
export function calleeName(node: TSESTree.CallExpression): string | undefined {
  const path = calleePath(node.callee, { allowThis: true });
  if (path === null) return undefined;
  return path.slice(path.lastIndexOf('.') + 1);
}
