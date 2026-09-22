import path from 'node:path';

import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  getComponentName,
  getFeatureName,
  isComponentEntryFile,
  isIgnoredPath,
  readDirSafe,
} from '../utils';

const RULE_NAME = 'component-folder-structure';

export interface ComponentFolderStructureOptions {
  readonly componentRoot?: string;
  readonly requiredSiblings?: readonly string[];
  readonly ignorePaths?: readonly string[];
}

type RuleOptions = [ComponentFolderStructureOptions];
type MessageIds = 'missingSiblings';

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
    ignorePaths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
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
    },
  },
  defaultOptions: [
    {
      componentRoot: DEFAULT_COMPONENT_ROOT,
      requiredSiblings: [...DEFAULT_REQUIRED_SIBLINGS],
      ignorePaths: [...DEFAULT_IGNORE_PATHS],
    },
  ],
  create(context, [options]) {
    const componentRoot = options.componentRoot ?? DEFAULT_COMPONENT_ROOT;
    const ignorePaths = options.ignorePaths ?? DEFAULT_IGNORE_PATHS;
    const siblingTemplates = options.requiredSiblings ?? DEFAULT_REQUIRED_SIBLINGS;
    const filename = context.filename;

    if (!isComponentEntryFile(filename) || isIgnoredPath(filename, ignorePaths)) {
      return {};
    }
    if (getFeatureName(filename, componentRoot) === null) {
      return {};
    }

    const name = getComponentName(filename);
    const dir = path.dirname(filename);
    const required = siblingTemplates.map((template) => resolveSibling(template, name));

    // Read the component directory once and test against the resulting set,
    // rather than a synchronous `existsSync` per required sibling. A
    // missing/unreadable dir yields an empty set, so every sibling is reported
    // missing.
    const present = readDirSafe(dir);
    const missing = required.filter((sibling) => !present.has(sibling));

    return {
      Program(node): void {
        if (missing.length > 0) {
          context.report({
            node,
            messageId: 'missingSiblings',
            data: { name, missing: missing.join(', ') },
          });
        }
      },
    };
  },
});
