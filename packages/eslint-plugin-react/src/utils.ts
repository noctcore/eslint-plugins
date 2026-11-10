import path from 'node:path';

import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/*
 * Layout-independent helpers specific to this package's rules: a basename
 * accessor, a dotted-suffix test for the file-role rules, the React hook-name
 * predicate and state-setter lookup. Helpers every plugin needs (globs, callee
 * paths, walkers) come from `@noctcore/eslint-utils`.
 */

/** Basename of a file path (e.g. `TaskCard.hooks.ts`), separator-agnostic. */
export function getBasename(filename: string): string {
  return path.basename(filename.split('\\').join('/'));
}

/**
 * True when the file's basename ends with any of the given dotted suffixes
 * (`.hooks.ts`, `.queries.ts`, ...). Basename-scoped so a directory that happens
 * to share the suffix never matches, and layout-independent by design.
 */
export function matchesAnySuffix(
  filename: string,
  suffixes: readonly string[],
): boolean {
  const basename = getBasename(filename);
  return suffixes.some((suffix) => basename.endsWith(suffix));
}

/** True for a React hook identifier name (`useThing`). */
export function isHookName(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z]/.test(name);
}

const STATE_HOOKS: ReadonlySet<string> = new Set(['useState', 'useReducer']);

/** `useState(...)` / `useReducer(...)`, also through a namespace (`React.useState`). */
function isStateHookCall(node: TSESTree.Node | null): node is TSESTree.CallExpression {
  if (node?.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return STATE_HOOKS.has(callee.name);
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    STATE_HOOKS.has(callee.property.name)
  );
}

/**
 * The `useState` / `useReducer` call whose second destructured element
 * `identifier` is bound to (`const [x, setX] = useState(...)`,
 * `const [state, dispatch] = useReducer(...)`), or null when the name comes
 * from anywhere else: a context hook, a prop, an import, or a global such as
 * `setTimeout`.
 */
export function stateSetterSource(
  identifier: TSESTree.Identifier,
  scope: TSESLint.Scope.Scope,
): TSESTree.CallExpression | null {
  const variable = ASTUtils.findVariable(scope, identifier);
  const def = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (
    def?.node.type !== AST_NODE_TYPES.VariableDeclarator ||
    def.node.id.type !== AST_NODE_TYPES.ArrayPattern ||
    def.node.id.elements[1] !== def.name ||
    !isStateHookCall(def.node.init)
  ) {
    return null;
  }
  return def.node.init;
}
