import { allowInAliasDescription, resolveAllowIn } from '@noctcore/eslint-utils';
import path from 'node:path';

import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  getComponentName,
  getFeatureName,
  isComponentEntryFile,
  isComponentFileName,
  isIgnoredPath,
  readDirSafe,
} from '../utils';

const RULE_NAME = 'component-folder-structure';

export interface ComponentFolderStructureOptions {
  readonly componentRoot?: string;
  readonly requiredSiblings?: readonly string[];
  readonly allowIn?: readonly string[];
  /** @deprecated Use `allowIn`. */
  readonly ignorePaths?: readonly string[];
  readonly requireOwnFolder?: boolean;
}

type RuleOptions = [ComponentFolderStructureOptions];
type MessageIds = 'missingSiblings' | 'notInOwnFolder';

/*
 * A component entry file (`<Name>/<Name>.tsx` anywhere under
 * `<componentRoot>/<feature>/`) must ship its sibling set on disk so logic,
 * types, story, and test always travel with the component. The default set is
 * the colocated `.hooks.ts`, `.types.ts`, `.stories.tsx`, `.test.tsx`, and the
 * `index.ts` barrel — so every component folder carries BOTH a story and a test
 * by construction.
 *
 * De-projected from nightcore: `componentRoot` (the anchor segment), the
 * `requiredSiblings` grammar, and `ignorePaths` are all options.
 *
 * The sibling grammar: an entry that starts with `.` is a name-relative suffix
 * (`.hooks.ts` -> `<Name>.hooks.ts`); any other entry is a literal filename
 * (`index.ts`). This lets the required set travel with each component's name
 * while still allowing fixed barrels.
 *
 * With `requireOwnFolder`, a component file under `<componentRoot>/<feature>/`
 * that is not an entry file is reported too: a sub-component dropped into
 * another component's folder (`BulkActionBar/MoreMenu.tsx`) or a loose `.tsx`
 * at a feature root (`splash/SplashRain.tsx`). Without it those files are
 * invisible to the rule, which is how they accumulate. Off by default, since it
 * reports files the sibling check has always left alone.
 *
 * Reports sit on the first line, so an editor does not underline the whole file.
 */
const DEFAULT_COMPONENT_ROOT = 'components';
const DEFAULT_IGNORE_PATHS: readonly string[] = ['**/ui/**'];
const DEFAULT_REQUIRED_SIBLINGS: readonly string[] = [
  '.hooks.ts',
  '.types.ts',
  '.stories.tsx',
  '.test.tsx',
  'index.ts',
];

/** Resolve a sibling template against the component name (see grammar above). */
function resolveSibling(template: string, name: string): string {
  return template.startsWith('.') ? `${name}${template}` : template;
}

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    componentRoot: { type: 'string' },
    requiredSiblings: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    allowIn: {
      type: 'array', items: { type: 'string' }, uniqueItems: true,
      description: 'Globs of files to skip. Default `["**/ui/**"]`; setting it replaces the default.',
    },
    ignorePaths: { type: 'array', items: { type: 'string' }, uniqueItems: true, description: allowInAliasDescription('ignorePaths') },
    requireOwnFolder: {
      type: 'boolean',
      description:
        'Also report a component file under a feature that is not the entry file of its own folder (a sub-component in another component folder, a loose file at the feature root). Default false.',
    },
  },
};

export const componentFolderStructureRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A component `<Name>/<Name>.tsx` under `<componentRoot>/<feature>/...` must have its sibling set (`.hooks.ts`, `.types.ts`, `.stories.tsx`, `.test.tsx`, `index.ts`) present on disk.',
    },
    schema: [optionSchema],
    messages: {
      missingSiblings:
        'Component `{{name}}` is missing sibling file(s): {{missing}}. Every component folder must carry its hooks, types, stories, test, and index barrel.',
      notInOwnFolder:
        'Component `{{name}}` is not in its own folder. Move it to `{{name}}/{{name}}.tsx` alongside its sibling set ({{required}}).',
    },
  },
  defaultOptions: [
    {
      componentRoot: DEFAULT_COMPONENT_ROOT,
      requiredSiblings: [...DEFAULT_REQUIRED_SIBLINGS],
    },
  ],
  create(context, [options]) {
    const componentRoot = options.componentRoot ?? DEFAULT_COMPONENT_ROOT;
    const ignorePaths = resolveAllowIn(options, ['ignorePaths'], DEFAULT_IGNORE_PATHS);
    const siblingTemplates = options.requiredSiblings ?? DEFAULT_REQUIRED_SIBLINGS;
    const filename = context.filename;

    const isEntry = isComponentEntryFile(filename);
    const isLoose = !isEntry && options.requireOwnFolder === true && isComponentFileName(filename);
    if ((!isEntry && !isLoose) || isIgnoredPath(filename, ignorePaths, context.cwd)) {
      return {};
    }
    if (getFeatureName(filename, componentRoot) === null) {
      return {};
    }

    const name = getComponentName(filename);
    const required = siblingTemplates.map((template) => resolveSibling(template, name));
    const firstLine = (): TSESTree.SourceLocation => ({
      start: { line: 1, column: 0 },
      end: { line: 1, column: context.sourceCode.lines[0]?.length ?? 0 },
    });

    // A component outside its own folder has no sibling set to check yet: the
    // fix is the move, so report that instead of listing siblings as missing.
    if (isLoose) {
      return {
        Program(): void {
          context.report({
            loc: firstLine(),
            messageId: 'notInOwnFolder',
            data: { name, required: required.join(', ') },
          });
        },
      };
    }

    // Read the component directory once and test against the resulting set,
    // rather than a synchronous `existsSync` per required sibling. A
    // missing/unreadable dir yields an empty set, so every sibling is reported
    // missing.
    const present = readDirSafe(path.dirname(filename));
    const missing = required.filter((sibling) => !present.has(sibling));

    return {
      Program(): void {
        if (missing.length > 0) {
          context.report({
            loc: firstLine(),
            messageId: 'missingSiblings',
            data: { name, missing: missing.join(', ') },
          });
        }
      },
    };
  },
});
