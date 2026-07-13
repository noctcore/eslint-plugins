import { readdirSync } from 'node:fs';
import path from 'node:path';

import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getBasename, isIgnoredPath } from '../utils';

const RULE_NAME = 'colocated-test-required';

export interface ColocatedTestRequiredOptions {
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
}

type RuleOptions = [ColocatedTestRequiredOptions];
type MessageIds = 'missingTest';

/*
 * A source file that matches an `include` glob must ship a colocated test on
 * disk — a sibling `<stem>.test.*` or `<stem>.spec.*` in the same directory.
 * Aimed at code where an untested change is most likely to bite: hooks
 * (`**\/use*.ts`), services (`**\/*.service.ts`), reducers, and so on. It reads
 * the file's directory (not TypeScript) so it is framework-agnostic.
 *
 * `include` is empty by default, so the rule is OFF until a consumer names the
 * globs that must be tested. There is no universal "everything needs a test"
 * default — that decision belongs to each codebase.
 *
 * The rule never reports on a test file about itself (a `*.test.*` / `*.spec.*`
 * file is skipped), and directory listings are cached for the lint run so a
 * folder with many gated files is read once, not once per file.
 */
const DEFAULT_INCLUDE: readonly string[] = [];
const DEFAULT_IGNORE: readonly string[] = [];

const TEST_SIBLING = /\.(test|spec)\.[^.]+$/;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    include: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    ignore: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

// Per-run cache of directory listings, keyed by directory. A missing/unreadable
// directory caches an empty list so every expected sibling reads as absent.
const dirCache = new Map<string, readonly string[]>();

function readDirCached(dir: string): readonly string[] {
  const cached = dirCache.get(dir);
  if (cached !== undefined) {
    return cached;
  }
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch {
    entries = [];
  }
  dirCache.set(dir, entries);
  return entries;
}

/** The basename with its final extension removed (`useThing.ts` -> `useThing`). */
function stemOf(basename: string): string {
  const ext = path.extname(basename);
  return ext === '' ? basename : basename.slice(0, -ext.length);
}

/** True when a `<stem>.test.*` / `<stem>.spec.*` sits next to the file. */
function hasColocatedTest(dir: string, stem: string): boolean {
  const prefix = `${stem}.`;
  return readDirCached(dir).some(
    (entry) => entry.startsWith(prefix) && TEST_SIBLING.test(entry),
  );
}

export const colocatedTestRequiredRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A source file matching an `include` glob must have a colocated `*.test.*` / `*.spec.*` sibling on disk. Off until `include` is configured.',
    },
    schema: [optionSchema],
    messages: {
      missingTest:
        'Source file `{{basename}}` has no colocated test. Add a sibling `{{stem}}.test.*` (or `.spec.*`) next to it.',
    },
  },
  defaultOptions: [{ include: [], ignore: [] }],
  create(context, [options]) {
    const include = options.include ?? DEFAULT_INCLUDE;
    const ignore = options.ignore ?? DEFAULT_IGNORE;
    const filename = context.filename;

    // Off unless configured; a file that is not gated (or is itself a test) exits early.
    if (include.length === 0 || !isIgnoredPath(filename, include)) {
      return {};
    }
    const basename = getBasename(filename);
    if (TEST_SIBLING.test(basename) || isIgnoredPath(filename, ignore)) {
      return {};
    }

    const stem = stemOf(basename);
    const dir = path.dirname(filename);

    return {
      Program(node): void {
        if (!hasColocatedTest(dir, stem)) {
          context.report({
            node,
            messageId: 'missingTest',
            data: { basename, stem },
          });
        }
      },
    };
  },
});
