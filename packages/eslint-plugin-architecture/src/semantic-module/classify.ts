/*
 * Ported from @boring-stack-pkg/eslint-plugin-module-boundaries 0.2.0
 * (MIT License, Copyright (c) 2026 the boringstack-xyz/eslint-plugins authors).
 * Provenance: boringstack-xyz/eslint-plugins@1f014dc,
 * eslint-plugin-module-boundaries/src/classifiers/classifyNode.ts,
 * src/analysis/semanticModule.ts and src/utils/reporting.ts.
 * Changed in the port: with `ignorePrivateDeclarations`, a declaration that is
 * exported later by name (`export { Foo }`, `export default Foo`) counts as
 * exported. Upstream skipped it, so a module written in that style was never
 * classified at all.
 */
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import {
  getDeclarationName,
  getVariableDeclaratorName,
  isAmbientDeclaration,
  unwrapExpression,
} from './ast';
import {
  collectSchemaImportContext,
  getConstantReason,
  isHookName,
  isReactComponentFunction,
  isReactComponentVariable,
  isSchemaExpression,
  type SchemaImportContext,
} from './classifiers';
import {
  normalizeOptions,
  type NormalizedOptions,
  type SemanticCategory,
  type SemanticClassification,
  type SingleSemanticModuleOptions,
  sortCategories,
} from './options';

interface ClassificationContext {
  readonly options: NormalizedOptions;
  readonly schemaImports: SchemaImportContext;
  /** Local names re-exported by a specifier list or `export default <name>`. */
  readonly exportedNames: ReadonlySet<string>;
  readonly isDefaultExport?: boolean;
}

export interface SemanticModuleAnalysis {
  readonly categories: ReadonlySet<SemanticCategory>;
  readonly classifications: readonly SemanticClassification[];
  readonly options: NormalizedOptions;
}

export function analyzeSemanticModule(
  program: TSESTree.Program,
  rawOptions: SingleSemanticModuleOptions,
): SemanticModuleAnalysis {
  const options = normalizeOptions(rawOptions);
  const context: ClassificationContext = {
    options,
    schemaImports: collectSchemaImportContext(program, options),
    exportedNames: collectLocallyExportedNames(program),
  };
  const classifications = program.body.flatMap((statement) =>
    classifyTopLevelStatement(statement, context),
  );
  return {
    categories: new Set(classifications.map((classification) => classification.category)),
    classifications,
    options,
  };
}

/** Names exported from this module by reference rather than by declaration. */
function collectLocallyExportedNames(program: TSESTree.Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration &&
      statement.source === null &&
      statement.declaration === null
    ) {
      for (const specifier of statement.specifiers) {
        if (specifier.local.type === AST_NODE_TYPES.Identifier) {
          names.add(specifier.local.name);
        }
      }
    } else if (
      statement.type === AST_NODE_TYPES.ExportDefaultDeclaration &&
      statement.declaration.type === AST_NODE_TYPES.Identifier
    ) {
      names.add(statement.declaration.name);
    }
  }
  return names;
}

function classifyTopLevelStatement(
  statement: TSESTree.ProgramStatement,
  context: ClassificationContext,
): SemanticClassification[] {
  switch (statement.type) {
    case AST_NODE_TYPES.ImportDeclaration:
    case AST_NODE_TYPES.EmptyStatement:
    case AST_NODE_TYPES.ExportAllDeclaration:
      return [];

    case AST_NODE_TYPES.ExportNamedDeclaration:
      return statement.declaration ? classifyDeclarationLike(statement.declaration, context) : [];

    case AST_NODE_TYPES.ExportDefaultDeclaration:
      return classifyDeclarationLike(statement.declaration, { ...context, isDefaultExport: true });

    default:
      if (!context.options.ignorePrivateDeclarations) {
        return classifyDeclarationLike(statement, context);
      }
      // Only the exported surface gives a module its meaning; a private helper,
      // config object or class serves that surface. A declaration exported
      // further down by name is surface all the same.
      return classifyExportedByName(statement, context);
  }
}

function classifyExportedByName(
  statement: TSESTree.ProgramStatement,
  context: ClassificationContext,
): SemanticClassification[] {
  if (context.exportedNames.size === 0) {
    return [];
  }
  if (statement.type === AST_NODE_TYPES.VariableDeclaration) {
    const exported = statement.declarations.filter((declarator) => {
      const name = getVariableDeclaratorName(declarator);
      return name !== undefined && context.exportedNames.has(name);
    });
    return exported.map((declarator) => classifyVariableDeclarator(declarator, context));
  }
  const name = getDeclarationName(statement);
  return name !== undefined && context.exportedNames.has(name)
    ? classifyDeclarationLike(statement, context)
    : [];
}

function classifyDeclarationLike(
  node: TSESTree.Node,
  context: ClassificationContext,
): SemanticClassification[] {
  if (isAmbientDeclaration(node)) {
    return context.options.ignoreAmbientDeclarations
      ? []
      : [classification('type', node, getDeclarationName(node), 'ambient declaration')];
  }

  switch (node.type) {
    case AST_NODE_TYPES.TSInterfaceDeclaration:
    case AST_NODE_TYPES.TSTypeAliasDeclaration:
    case AST_NODE_TYPES.TSModuleDeclaration:
      return [
        classification('type', node, getDeclarationName(node), 'TypeScript type-space declaration'),
      ];

    case AST_NODE_TYPES.TSEnumDeclaration:
      return [
        classification(
          context.options.enumCategory,
          node,
          getDeclarationName(node),
          context.options.enumCategory === 'type' ? 'enum configured as type' : 'enum declaration',
        ),
      ];

    case AST_NODE_TYPES.ClassDeclaration:
      return [classification('class', node, getDeclarationName(node), 'class declaration')];

    case AST_NODE_TYPES.FunctionDeclaration:
      return [classifyFunction(node, getDeclarationName(node), context, 'function declaration')];

    case AST_NODE_TYPES.VariableDeclaration:
      return node.declarations.map((declarator) => classifyVariableDeclarator(declarator, context));

    case AST_NODE_TYPES.ArrowFunctionExpression:
    case AST_NODE_TYPES.FunctionExpression:
      return [classifyFunction(node, undefined, context, 'function expression')];

    case AST_NODE_TYPES.ClassExpression:
      return [classification('class', node, getDeclarationName(node), 'class expression')];

    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.ArrayExpression:
    case AST_NODE_TYPES.ObjectExpression:
    case AST_NODE_TYPES.Literal:
    case AST_NODE_TYPES.TemplateLiteral:
      return [classifyDefaultExpression(node, context)];

    case AST_NODE_TYPES.TSDeclareFunction:
      // Ambient `declare function` returned above; this is an overload signature.
      return [
        classification('function', node, getDeclarationName(node), 'function overload signature'),
      ];

    default:
      return [];
  }
}

function classifyFunction(
  node: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
  name: string | undefined,
  context: ClassificationContext,
  reason: string,
): SemanticClassification {
  if (isHookName(name, context.options)) {
    return classification('hook', node, name, 'function name matches hook pattern');
  }
  if (isReactComponentFunction(node, name, context.options, context.isDefaultExport === true)) {
    return classification(
      'react-component',
      node,
      name,
      `${reason === 'function declaration' ? 'function component' : 'function expression'} returns JSX or React element`,
    );
  }
  return classification('function', node, name, reason);
}

function classifyVariableDeclarator(
  declarator: TSESTree.VariableDeclarator,
  context: ClassificationContext,
): SemanticClassification {
  const name = getVariableDeclaratorName(declarator);
  const init = declarator.init ? unwrapExpression(declarator.init) : null;

  if (init && isSchemaExpression(init, context.schemaImports)) {
    return classification('schema', declarator, name, 'schema builder expression');
  }
  if (isReactComponentVariable(declarator, context.options)) {
    return classification('react-component', declarator, name, 'React component variable');
  }
  if (isHookName(name, context.options)) {
    return classification('hook', declarator, name, 'variable name matches hook pattern');
  }
  if (
    init?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    init?.type === AST_NODE_TYPES.FunctionExpression
  ) {
    return classifyFunction(init, name, context, 'function expression');
  }
  if (init?.type === AST_NODE_TYPES.ClassExpression) {
    return classification('class', declarator, name, 'class expression');
  }
  return classification('constant', declarator, name, getConstantReason(init));
}

function classifyDefaultExpression(
  expression: TSESTree.Expression,
  context: ClassificationContext,
): SemanticClassification {
  const unwrapped = unwrapExpression(expression);
  if (isSchemaExpression(unwrapped, context.schemaImports)) {
    return classification('schema', expression, undefined, 'default schema expression');
  }
  if (
    unwrapped.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    unwrapped.type === AST_NODE_TYPES.FunctionExpression
  ) {
    return classifyFunction(unwrapped, undefined, context, 'function expression');
  }
  if (unwrapped.type === AST_NODE_TYPES.ClassExpression) {
    return classification('class', expression, undefined, 'default class expression');
  }
  return classification('constant', expression, undefined, getConstantReason(unwrapped));
}

function classification(
  category: SemanticCategory,
  node: TSESTree.Node,
  declarationName: string | undefined,
  reason: string,
): SemanticClassification {
  return declarationName ? { category, node, reason, declarationName } : { category, node, reason };
}

export function buildMixedCategoriesMessage(
  classifications: readonly SemanticClassification[],
  debug: boolean,
): string {
  const categories = sortCategories(classifications.map((entry) => entry.category));
  const lines = [
    'Mixed semantic categories detected in module:',
    ...categories.map((category) => `- ${category}`),
  ];
  if (debug) {
    lines.push('', 'Detected declarations:');
    for (const entry of classifications) {
      lines.push(`- ${entry.category}: ${entry.declarationName ?? '<anonymous>'} (${entry.reason})`);
    }
  }
  lines.push(
    '',
    'A module must contain only one semantic concern.',
    'Move declarations into separate files/modules.',
  );
  return lines.join('\n');
}
