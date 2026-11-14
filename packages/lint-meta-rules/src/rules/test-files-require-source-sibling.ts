import type { IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from './glob-match';
import { DEFAULT_SKIP_DIRS, globFiles, recursiveGlobs, stripTrailingSlashes } from './shared';

/** Options for {@link createTestFilesRequireSourceSiblingRule}. */
export interface TestFilesRequireSourceSiblingOptions {
  /** Directories (or globs such as `packages/*\/src`) searched for colocated tests. Default `['src']`. */
  readonly roots?: readonly string[];
  /** File-name suffixes that mark a test; the longest matching one is stripped to get the source base. Default `['.test.ts', '.test.tsx']`. */
  readonly testSuffixes?: readonly string[];
  /** Extensions a covered source may have. Default `['.ts', '.tsx', '.mts', '.cts', '.js']`. */
  readonly sourceExtensions?: readonly string[];
  /** Globs over the repo-relative test path; a matching test is skipped. Default `[]`. */
  readonly ignore?: readonly string[];
  /** Whether a directory module (`Button/index.tsx` beside `Button.test.tsx`) counts as the source. Default `true`. */
  readonly directoryModules?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'test-files-require-source-sibling';

const DEFAULT_ROOTS: readonly string[] = ['src'];
const DEFAULT_TEST_SUFFIXES: readonly string[] = ['.test.ts', '.test.tsx'];
const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js'];

/** `path` without the longest entry of `suffixes` it ends with, or null when none matches. */
function stripLongestSuffix(path: string, suffixes: readonly string[]): string | null {
  let longest = '';
  for (const suffix of suffixes) {
    if (suffix.length > longest.length && path.endsWith(suffix)) longest = suffix;
  }
  return longest === '' ? null : path.slice(0, path.length - longest.length);
}

/**
 * Every colocated test must sit next to the source it covers: a file with the
 * test's base name and one of `sourceExtensions`, or, with `directoryModules`,
 * a folder of that name holding an `index` with one of those extensions. The
 * complement of `test-sibling-enforcement`, which asks the reverse (every
 * chosen source has a test).
 *
 * Only `<base><ext>` and `<base>/index<ext>` are probed, never the bare base:
 * on a real tree `exists` is true for a plain folder, which is not a source.
 *
 * Opt-in: the id is in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` skips it.
 */
export function createTestFilesRequireSourceSiblingRule(
  options: TestFilesRequireSourceSiblingOptions = {},
): IMetaRule {
  const roots = (options.roots ?? DEFAULT_ROOTS).map(stripTrailingSlashes);
  const testSuffixes = options.testSuffixes ?? DEFAULT_TEST_SUFFIXES;
  const sourceExtensions = options.sourceExtensions ?? DEFAULT_SOURCE_EXTENSIONS;
  const ignore = options.ignore ?? [];
  const directoryModules = options.directoryModules ?? true;
  const ciCritical = options.ciCritical ?? true;

  return {
    id: RULE_ID,
    category: 'testing',
    ciCritical,
    description:
      "Every colocated test file must sit next to the source it covers: a same-named source file, or a directory module's index.",
    run(ctx) {
      const violations: IViolation[] = [];
      const tests = globFiles(ctx.glob, recursiveGlobs(roots, testSuffixes), DEFAULT_SKIP_DIRS);
      for (const file of tests) {
        if (matchesAnyGlob(file, ignore)) continue;
        const base = stripLongestSuffix(file, testSuffixes);
        if (base === null) continue;
        const candidates = sourceExtensions.map((ext) => `${base}${ext}`);
        if (directoryModules) {
          candidates.push(...sourceExtensions.map((ext) => `${base}/index${ext}`));
        }
        if (!candidates.some((candidate) => ctx.exists(candidate))) {
          violations.push({
            file,
            rule: RULE_ID,
            message: `'${file}' has no source beside it (looked for ${candidates.join(', ')}). Move the test next to the code it covers, or delete it.`,
          });
        }
      }
      return violations;
    },
  };
}
