/*
 * Ported from @boring-stack-pkg/eslint-plugin-module-boundaries 0.2.0
 * (MIT License, Copyright (c) 2026 the boringstack-xyz/eslint-plugins authors).
 * Provenance: boringstack-xyz/eslint-plugins@1f014dc,
 * eslint-plugin-module-boundaries/src/classifiers/react.ts, hooks.ts,
 * schema.ts and constants.ts.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import {
  containsJsx,
  containsNode,
  functionReturnsJsx,
  getVariableDeclaratorName,
  unwrapExpression,
} from './ast';
import type { NormalizedOptions, SchemaLibrary } from './options';

// ---------------------------------------------------------------- hooks

export function isHookName(name: string | undefined, options: NormalizedOptions): boolean {
  if (!options.hookDetection.enabled || !name) {
    return false;
  }
  return options.hookDetection.namePattern.test(name);
}

// ---------------------------------------------------------------- react

type FunctionLike =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

export function isReactComponentName(name: string | undefined): boolean {
  return Boolean(name && /^[A-Z][A-Za-z0-9]*$/u.test(name));
}

export function isReactComponentFunction(
  node: FunctionLike,
  name: string | undefined,
  options: NormalizedOptions,
  isDefaultExport = false,
): boolean {
  if (!options.reactComponentDetection.enabled) {
    return false;
  }
  if (!isReactComponentName(name) && !isDefaultExport) {
    return false;
  }
  if (node.returnType && typeReferencesJsxValue(node.returnType.typeAnnotation)) {
    return true;
  }
  return functionReturnsJsx(node);
}

export function isReactComponentVariable(
  declarator: TSESTree.VariableDeclarator,
  options: NormalizedOptions,
): boolean {
  if (!options.reactComponentDetection.enabled) {
    return false;
  }
  const name = getVariableDeclaratorName(declarator);
  if (!isReactComponentName(name)) {
    return false;
  }
  if (
    declarator.id.type === AST_NODE_TYPES.Identifier &&
    declarator.id.typeAnnotation &&
    typeReferencesReactComponent(declarator.id.typeAnnotation.typeAnnotation)
  ) {
    return true;
  }
  if (!declarator.init) {
    return false;
  }
  if (
    declarator.init.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    declarator.init.type === AST_NODE_TYPES.FunctionExpression
  ) {
    return isReactComponentFunction(declarator.init, name, options);
  }
  return containsJsx(declarator.init);
}

const REACT_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  'FC',
  'FunctionComponent',
  'React.FC',
  'React.FunctionComponent',
]);
const JSX_VALUE_TYPES: ReadonlySet<string> = new Set([
  'JSX.Element',
  'React.ReactElement',
  'React.ReactNode',
]);

function typeReferencesReactComponent(node: TSESTree.Node): boolean {
  return containsNode(
    node,
    (candidate) =>
      candidate.type === AST_NODE_TYPES.TSTypeReference &&
      REACT_COMPONENT_TYPES.has(entityNameToString(candidate.typeName)),
  );
}

function typeReferencesJsxValue(node: TSESTree.Node): boolean {
  return containsNode(
    node,
    (candidate) =>
      candidate.type === AST_NODE_TYPES.TSTypeReference &&
      JSX_VALUE_TYPES.has(entityNameToString(candidate.typeName)),
  );
}

function entityNameToString(entityName: TSESTree.EntityName): string {
  if (entityName.type === AST_NODE_TYPES.Identifier) {
    return entityName.name;
  }
  if (entityName.type === AST_NODE_TYPES.TSQualifiedName) {
    return `${entityNameToString(entityName.left)}.${entityName.right.name}`;
  }
  // `this` can appear in some type positions (`this['prop']`).
  return 'this';
}

// ---------------------------------------------------------------- schema

const SCHEMA_LIBRARY_MODULES: Record<SchemaLibrary, readonly string[]> = {
  zod: ['zod'],
  yup: ['yup'],
  valibot: ['valibot'],
};

const SCHEMA_BUILDER_NAMES: ReadonlySet<string> = new Set([
  'array',
  'boolean',
  'date',
  'enum',
  'literal',
  'number',
  'object',
  'record',
  'string',
  'tuple',
  'union',
]);

export interface SchemaImportContext {
  readonly namespaceIdentifiers: ReadonlySet<string>;
  readonly builderIdentifiers: ReadonlySet<string>;
}

/**
 * Schema detection only switches on for identifiers imported from an enabled
 * schema library, so a local variable that happens to be called `z` or `yup`
 * is never mistaken for a schema builder.
 */
export function collectSchemaImportContext(
  program: TSESTree.Program,
  options: NormalizedOptions,
): SchemaImportContext {
  const namespaceIdentifiers = new Set<string>();
  const builderIdentifiers = new Set<string>();
  const enabledModules = new Set(
    options.schemaLibraries.flatMap((library) => SCHEMA_LIBRARY_MODULES[library]),
  );

  for (const statement of program.body) {
    if (
      statement.type !== AST_NODE_TYPES.ImportDeclaration ||
      statement.importKind === 'type' ||
      !enabledModules.has(String(statement.source.value))
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier ||
        specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier
      ) {
        namespaceIdentifiers.add(specifier.local.name);
        continue;
      }
      if (specifier.importKind === 'type') {
        continue;
      }
      const importedName =
        specifier.imported.type === AST_NODE_TYPES.Identifier
          ? specifier.imported.name
          : String(specifier.imported.value);
      if (importedName === 'z') {
        namespaceIdentifiers.add(specifier.local.name);
      }
      if (SCHEMA_BUILDER_NAMES.has(importedName)) {
        builderIdentifiers.add(specifier.local.name);
      }
    }
  }

  return { namespaceIdentifiers, builderIdentifiers };
}

export function isSchemaExpression(
  expression: TSESTree.Expression,
  context: SchemaImportContext,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const rootName = expressionRootIdentifier(unwrapped.callee);
  if (!rootName) {
    return false;
  }
  return context.namespaceIdentifiers.has(rootName) || context.builderIdentifiers.has(rootName);
}

function expressionRootIdentifier(
  node: TSESTree.Expression | TSESTree.PrivateIdentifier | TSESTree.Super,
): string | null {
  switch (node.type) {
    case AST_NODE_TYPES.Identifier:
      return node.name;
    case AST_NODE_TYPES.MemberExpression:
      return expressionRootIdentifier(node.object);
    case AST_NODE_TYPES.CallExpression:
      return expressionRootIdentifier(node.callee);
    case AST_NODE_TYPES.ChainExpression:
      return expressionRootIdentifier(node.expression);
    default:
      return null;
  }
}

// ---------------------------------------------------------------- constants

export function getConstantReason(expression: TSESTree.Expression | null): string {
  if (!expression) {
    return 'top-level variable declaration without initializer';
  }
  switch (unwrapExpression(expression).type) {
    case AST_NODE_TYPES.Literal:
      return 'literal runtime value';
    case AST_NODE_TYPES.ObjectExpression:
      return 'object literal runtime value';
    case AST_NODE_TYPES.ArrayExpression:
      return 'array literal runtime value';
    case AST_NODE_TYPES.TemplateLiteral:
      return 'template literal runtime value';
    case AST_NODE_TYPES.CallExpression:
      return 'computed top-level runtime value';
    default:
      return 'top-level runtime value';
  }
}
