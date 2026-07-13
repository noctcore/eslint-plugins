import path from 'node:path';

import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getBasename, isIgnoredPath } from '../utils';

const RULE_NAME = 'filename-matches-export';

export interface FilenameMatchesExportOptions {
  readonly ignore?: readonly string[];
}

type RuleOptions = [FilenameMatchesExportOptions];
type MessageIds = 'filenameMismatch' | 'renameExport';

/*
 * A file's basename should announce what it exports. When a module has a single
 * "primary" export — a default export, or (with no default) its sole named
 * export — that export's identifier must match the filename. `helpers.ts` that
 * exports one thing called `formatDate` hides its contents from the file tree;
 * either the file or the export is misnamed.
 *
 * "Primary export" is defined narrowly so the rule stays quiet on real modules:
 *   1. If the file has a default export with a name (`export default function
 *      Foo`, `export default class Foo`, `export default Foo`) that name is the
 *      primary export. An anonymous default (`export default () => …`) has no
 *      identifier to compare, so the file is skipped.
 *   2. Otherwise, if the file has exactly one local named export, that is the
 *      primary export.
 *   3. Otherwise (no primary, or several named exports) the file is skipped.
 *
 * Matching is convention-agnostic: the basename and the identifier are compared
 * with separators and case removed, so `task-card.ts` ↔ `TaskCard`,
 * `use_thing.ts` ↔ `useThing`, and `TaskCard.tsx` ↔ `TaskCard` all match. Only a
 * genuine mismatch (`helpers.ts` ↔ `formatDate`) reports.
 *
 * The rename is offered as a *suggestion*, never an autofix: renaming an export
 * to match its file (the code-side resolution — the other is renaming the file)
 * rewrites a public identifier, which a human should choose. Index files and
 * `ignore` globs are skipped.
 */
const DEFAULT_IGNORE: readonly string[] = [];

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ignore: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

interface PrimaryExport {
  readonly name: string;
  readonly node: TSESTree.Identifier;
}

/** The file's basename with its final extension removed (`TaskCard.tsx` -> `TaskCard`). */
function stemOf(filename: string): string {
  const basename = getBasename(filename);
  const ext = path.extname(basename);
  return ext === '' ? basename : basename.slice(0, -ext.length);
}

/** Case- and separator-insensitive comparison key (`Task-Card` -> `taskcard`). */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The declaration identifier a named export binds, or `null` when anonymous. */
function namedExportId(
  decl: TSESTree.ExportNamedDeclaration,
): TSESTree.Identifier | null {
  if (decl.declaration === null) {
    return null;
  }
  const d = decl.declaration;
  switch (d.type) {
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.ClassDeclaration:
      return d.id;
    case AST_NODE_TYPES.TSTypeAliasDeclaration:
    case AST_NODE_TYPES.TSInterfaceDeclaration:
    case AST_NODE_TYPES.TSEnumDeclaration:
      return d.id;
    case AST_NODE_TYPES.VariableDeclaration: {
      const only = d.declarations.length === 1 ? d.declarations[0] : undefined;
      return only !== undefined && only.id.type === AST_NODE_TYPES.Identifier ? only.id : null;
    }
    default:
      return null;
  }
}

/** The default export's identifier when it has one, else `null` (anonymous). */
function defaultExportId(
  decl: TSESTree.ExportDefaultDeclaration,
): TSESTree.Identifier | null {
  const d = decl.declaration;
  if (
    (d.type === AST_NODE_TYPES.FunctionDeclaration ||
      d.type === AST_NODE_TYPES.ClassDeclaration) &&
    d.id !== null
  ) {
    return d.id;
  }
  return d.type === AST_NODE_TYPES.Identifier ? d : null;
}

/** Resolve the file's single primary export, or `null` when there is none. */
function resolvePrimary(body: readonly TSESTree.ProgramStatement[]): PrimaryExport | null {
  let hasDefault = false;
  let defaultId: TSESTree.Identifier | null = null;
  const named: TSESTree.Identifier[] = [];

  for (const stmt of body) {
    if (stmt.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
      hasDefault = true;
      defaultId = defaultExportId(stmt);
    } else if (stmt.type === AST_NODE_TYPES.ExportNamedDeclaration && stmt.source === null) {
      const id = namedExportId(stmt);
      if (id !== null) {
        named.push(id);
      } else if (stmt.declaration === null) {
        for (const spec of stmt.specifiers) {
          if (spec.exported.type === AST_NODE_TYPES.Identifier) {
            named.push(spec.exported);
          }
        }
      }
    }
  }

  if (hasDefault) {
    return defaultId === null ? null : { name: defaultId.name, node: defaultId };
  }
  const only = named.length === 1 ? named[0] : undefined;
  return only !== undefined ? { name: only.name, node: only } : null;
}

/** The module-scope variable bound to `name`, or `null`. */
function moduleVariable(
  sourceCode: TSESLint.SourceCode,
  name: string,
): TSESLint.Scope.Variable | null {
  const globalScope = sourceCode.scopeManager?.globalScope ?? null;
  if (globalScope === null) {
    return null;
  }
  const moduleScope = globalScope.childScopes[0] ?? globalScope;
  return moduleScope.variables.find((v) => v.name === name) ?? null;
}

const IMPORT_DEF_NODES = new Set<string>([
  AST_NODE_TYPES.ImportSpecifier,
  AST_NODE_TYPES.ImportDefaultSpecifier,
  AST_NODE_TYPES.ImportNamespaceSpecifier,
]);

/** True when the binding originates from an `import` (renaming it would break the import). */
function isImportBinding(variable: TSESLint.Scope.Variable): boolean {
  return variable.defs.some((def) => IMPORT_DEF_NODES.has(def.node.type));
}

export const filenameMatchesExportRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description:
        "A file's basename must match its primary export (a default export, or the sole named export).",
    },
    schema: [optionSchema],
    messages: {
      filenameMismatch:
        "File `{{basename}}` exports `{{name}}` as its primary export — the basename should match it (rename the file to `{{expected}}`, or the export).",
      renameExport: 'Rename the export to `{{expected}}` to match the filename.',
    },
  },
  defaultOptions: [{ ignore: [] }],
  create(context, [options]) {
    const ignore = options.ignore ?? DEFAULT_IGNORE;
    const filename = context.filename;
    const stem = stemOf(filename);

    if (stem === 'index' || isIgnoredPath(filename, ignore)) {
      return {};
    }

    return {
      Program(node): void {
        const primary = resolvePrimary(node.body);
        if (primary === null || normalize(primary.name) === normalize(stem)) {
          return;
        }

        const basename = getBasename(filename);
        const canRename = VALID_IDENTIFIER.test(stem) && stem !== primary.name;

        context.report({
          node: primary.node,
          messageId: 'filenameMismatch',
          data: { basename, name: primary.name, expected: stem },
          suggest: canRename
            ? [
                {
                  messageId: 'renameExport',
                  data: { expected: stem },
                  fix: (fixer): TSESLint.RuleFix[] => {
                    const variable = moduleVariable(context.sourceCode, primary.name);
                    // Rename every occurrence of the binding when it is a
                    // module-local declaration; for an import-backed or
                    // unresolved binding, touch only the primary identifier so
                    // the suggestion never rewrites an unrelated import.
                    if (variable !== null && !isImportBinding(variable)) {
                      const targets = new Map<number, TSESTree.Node>();
                      for (const id of variable.identifiers) {
                        targets.set(id.range[0], id);
                      }
                      for (const ref of variable.references) {
                        targets.set(ref.identifier.range[0], ref.identifier);
                      }
                      return [...targets.values()].map((id) => fixer.replaceText(id, stem));
                    }
                    return [fixer.replaceText(primary.node, stem)];
                  },
                },
              ]
            : undefined,
        });
      },
    };
  },
});
