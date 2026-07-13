import path from 'node:path';

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getBasename, isIgnoredPath, isPascalCase, siblingExists } from '../utils';

const RULE_NAME = 'index-must-reexport-default';

export interface IndexMustReexportDefaultOptions {
  readonly ignorePaths?: readonly string[];
}

type RuleOptions = [IndexMustReexportDefaultOptions];
type MessageIds = 'missingDefaultReexport';

/*
 * The `index.ts` barrel in a component folder must re-export the component's
 * default export (`export { default as <Name> } from './<Name>'`) so consumers
 * import the folder, not the file. Only `index.ts` files that sit next to a
 * `<Folder>.tsx` of the same PascalCase name are checked, so non-component
 * barrels are untouched.
 *
 * De-projected from shiranami: the rule's previously hardcoded ignore glob is
 * now an `ignorePaths` option (default: none), keeping the rule generic.
 */
const DEFAULT_IGNORE_PATHS: readonly string[] = [];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ignorePaths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

function reexportsDefault(node: TSESTree.ExportNamedDeclaration): boolean {
  if (node.source === null) {
    return false;
  }
  return node.specifiers.some(
    (specifier) =>
      specifier.local.type === AST_NODE_TYPES.Identifier && specifier.local.name === 'default',
  );
}

export const indexMustReexportDefaultRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "A component folder's `index.ts` must re-export the component default (`export { default as <Name> } from './<Name>'`).",
    },
    schema: [optionSchema],
    messages: {
      missingDefaultReexport:
        "`index.ts` must re-export the {{name}} default: `export { default as {{name}} } from './{{name}}'`.",
    },
  },
  defaultOptions: [{ ignorePaths: [] }],
  create(context, [options]) {
    const ignorePaths = options.ignorePaths ?? DEFAULT_IGNORE_PATHS;
    const filename = context.filename;
    if (getBasename(filename) !== 'index.ts' || isIgnoredPath(filename, ignorePaths)) {
      return {};
    }

    const dir = path.dirname(filename);
    const folderName = path.basename(dir);
    if (!isPascalCase(folderName) || !siblingExists(dir, `${folderName}.tsx`)) {
      return {};
    }

    let hasDefaultReexport = false;

    return {
      ExportNamedDeclaration(node): void {
        if (reexportsDefault(node)) {
          hasDefaultReexport = true;
        }
      },
      'Program:exit'(node): void {
        if (!hasDefaultReexport) {
          context.report({
            node,
            messageId: 'missingDefaultReexport',
            data: { name: folderName },
          });
        }
      },
    };
  },
});
