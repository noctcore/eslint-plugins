import { fileMatchesAnyGlob, resolveAllowIn } from '@noctcore/eslint-utils';
import path from 'node:path';

import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';
import type { TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { getBasename } from '../utils';

const RULE_NAME = 'file-naming-pattern';
const FOLDER_PLACEHOLDER = '{folder}';

export interface FileNamingPatternOptions {
  readonly folders?: readonly string[];
  readonly pattern?: string;
  readonly allowIn?: readonly string[];
}

type RuleOptions = [FileNamingPatternOptions];
type MessageIds = 'mismatch' | 'invalidPattern';

/*
 * In a folder matched by `folders`, a file's basename must match `pattern`, a
 * regular expression source in which every `{folder}` stands for the file's
 * immediate parent folder name (escaped, so a folder named `a.b` matches only
 * `a.b`). `account/account.routes.ts` and `account/account.ts` pass
 * `^{folder}(\.[a-z-]+)?\.ts$`; `account/routes.ts` does not.
 *
 * Both options are empty by default, so the rule is OFF until a consumer says
 * which folders name their files after themselves and how.
 */
const DEFAULT_ALLOW_IN: readonly string[] = [];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    folders: {
      type: 'array', items: { type: 'string' }, uniqueItems: true,
      description:
        'Globs matched against the folder that directly contains the file. Empty, the default, turns the rule off.',
    },
    pattern: {
      type: 'string',
      description:
        'Regular expression source the file basename must match, with every `{folder}` replaced by the escaped name of the parent folder. Unset turns the rule off.',
    },
    allowIn: {
      type: 'array', items: { type: 'string' }, uniqueItems: true,
      description: 'Globs of files exempt even when their folder matches `folders`.',
    },
  },
};

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every `{folder}` in the template becomes the escaped folder name. */
function substituteFolder(template: string, folder: string): string {
  return template.split(FOLDER_PLACEHOLDER).join(escapeRegExpLiteral(folder));
}

function compilePattern(source: string): RegExp | Error {
  try {
    return new RegExp(source, 'u');
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export const fileNamingPatternRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "In a folder matched by `folders`, a file's basename must match `pattern`, a regular expression built from the folder's name.",
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      mismatch:
        '`{{basename}}` does not follow the naming pattern of folder `{{folder}}`: rename it to match `{{expected}}`.',
      invalidPattern:
        'The `pattern` option `{{pattern}}` is not a valid regular expression for folder `{{folder}}` ({{reason}}). Fix the rule configuration.',
    },
  },
  defaultOptions: [{ folders: [] }],
  create(context, [options]) {
    const folders = options.folders ?? [];
    const template = options.pattern;
    if (folders.length === 0 || template === undefined || template === '') {
      return {};
    }

    const filename = context.filename;
    const dir = path.dirname(filename);
    if (!fileMatchesAnyGlob(dir, folders, context.cwd)) {
      return {};
    }
    const allowIn = resolveAllowIn(options, [], DEFAULT_ALLOW_IN);
    if (fileMatchesAnyGlob(filename, allowIn, context.cwd)) {
      return {};
    }

    const folder = path.basename(dir);
    const basename = getBasename(filename);
    const expected = substituteFolder(template, folder);
    const compiled = compilePattern(expected);
    const firstLine = (): TSESTree.SourceLocation => ({
      start: { line: 1, column: 0 },
      end: { line: 1, column: context.sourceCode.lines[0]?.length ?? 0 },
    });

    return {
      Program(): void {
        if (compiled instanceof Error) {
          context.report({
            loc: firstLine(),
            messageId: 'invalidPattern',
            data: { pattern: template, folder, reason: compiled.message },
          });
        } else if (!compiled.test(basename)) {
          context.report({
            loc: firstLine(),
            messageId: 'mismatch',
            data: { basename, folder, expected },
          });
        }
      },
    };
  },
});
