import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/** The name of a non-computed property key (`a:` or `'a':`), else null. */
export function propertyName(property: TSESTree.Property): string | null {
  if (property.computed) return null;
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

/** True for `require('electron')`. */
export function isRequireElectron(node: TSESTree.Node | null | undefined): boolean {
  return (
    node?.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'require' &&
    node.arguments[0]?.type === AST_NODE_TYPES.Literal &&
    node.arguments[0].value === 'electron'
  );
}

/**
 * Whether an identifier is bound to the whole `electron` module: a default or
 * namespace import, or `const electron = require('electron')`.
 */
export function isElectronModule(identifier: TSESTree.Identifier, scope: TSESLint.Scope.Scope): boolean {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def === undefined) return false;
  if (def.type === 'ImportBinding') {
    return (
      def.parent.type === AST_NODE_TYPES.ImportDeclaration &&
      def.parent.source.value === 'electron' &&
      (def.node.type === AST_NODE_TYPES.ImportDefaultSpecifier ||
        def.node.type === AST_NODE_TYPES.ImportNamespaceSpecifier)
    );
  }
  return (
    def.type === 'Variable' &&
    def.node.id.type === AST_NODE_TYPES.Identifier &&
    isRequireElectron(def.node.init)
  );
}

/**
 * Whether an identifier is bound to the `electron` export `name`:
 * `import { name } from 'electron'` (aliased or not) or
 * `const { name } = require('electron')`.
 */
export function isElectronExport(
  identifier: TSESTree.Identifier,
  name: string,
  scope: TSESLint.Scope.Scope,
): boolean {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def === undefined) return false;
  if (def.type === 'ImportBinding') {
    if (def.node.type !== AST_NODE_TYPES.ImportSpecifier) return false;
    if (def.parent.type !== AST_NODE_TYPES.ImportDeclaration || def.parent.source.value !== 'electron') {
      return false;
    }
    const imported = def.node.imported;
    return (imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value) === name;
  }
  if (def.type !== 'Variable' || def.node.id.type !== AST_NODE_TYPES.ObjectPattern) return false;
  if (!isRequireElectron(def.node.init)) return false;
  const property = def.name.parent;
  return property?.type === AST_NODE_TYPES.Property && propertyName(property) === name;
}
