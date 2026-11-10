import type { IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob, normalizeRelative } from '../rules/glob-match';
import { DEFAULT_SKIP_DIRS, globFiles } from '../rules/shared';
import { detectRunnerScopes, relativeTo, type RunnerName, type RunnerScope, scopeCollects } from './runners';

/** A runner scope declared by hand, for a runner the rule cannot detect or a config it cannot read. */
export interface DeclaredRunner {
  /** A label for messages, such as `vitest:web`. */
  readonly name: string;
  /** Repo-relative directory the patterns are relative to (`''` for the root). */
  readonly dir: string;
  /** Globs of the test files this runner collects, relative to `dir`. */
  readonly include: readonly string[];
  /** Globs it skips, relative to `dir`. Default `[]`. */
  readonly exclude?: readonly string[];
}

/**
 * Options for {@link createTestFileMatchesRunnerIncludeRule}.
 *
 * New in this package: the gap it closes was found in a consumer repo where a
 * test file satisfied `test-sibling-enforcement` while its runner never
 * collected it.
 */
export interface TestFileMatchesRunnerIncludeOptions {
  /** Globs of the files that are tests. Default `**\/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`. */
  readonly testFileGlobs?: readonly string[];
  /** Runners to detect from their config files and package scripts. Default all four. */
  readonly detect?: readonly RunnerName[];
  /** Extra runner scopes, added to the detected ones. Default `[]`. */
  readonly runners?: readonly DeclaredRunner[];
  /** Globs of test files never reported (a fixture that only looks like a test). Default `[]`. */
  readonly allowedFiles?: readonly string[];
  /**
   * Also report a test file that sits under no runner at all. Default `false`: a file is reported
   * only when a runner covers its directory and none of its patterns collect it.
   */
  readonly requireRunner?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'test-file-matches-runner-include';

export const DEFAULT_TEST_FILE_GLOBS: readonly string[] = ['**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

const ALL_RUNNERS: readonly RunnerName[] = ['vitest', 'jest', 'bun', 'playwright'];

function declaredScope(runner: DeclaredRunner): RunnerScope {
  return {
    kind: 'readable',
    runner: runner.name,
    source: 'options',
    dir: normalizeRelative(runner.dir),
    include: runner.include,
    exclude: runner.exclude ?? [],
  };
}

function covers(scope: RunnerScope, file: string): boolean {
  return relativeTo(file, normalizeRelative(scope.dir)) !== null;
}

/** Every test file must be collected by a runner whose directory holds it. */
export function createTestFileMatchesRunnerIncludeRule(
  options: TestFileMatchesRunnerIncludeOptions = {},
): IMetaRule {
  const testFileGlobs = options.testFileGlobs ?? DEFAULT_TEST_FILE_GLOBS;
  const detect = options.detect ?? ALL_RUNNERS;
  const allowed = options.allowedFiles ?? [];
  const requireRunner = options.requireRunner ?? false;
  return {
    id: RULE_ID,
    category: 'testing',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every test file must match the include patterns of a test runner that covers its directory, so a test that never runs cannot pass as coverage.',
    run(ctx) {
      const scopes = [...detectRunnerScopes(ctx, detect), ...(options.runners ?? []).map(declaredScope)];
      const violations: IViolation[] = [];
      for (const file of globFiles((p) => ctx.glob(p), testFileGlobs, DEFAULT_SKIP_DIRS)) {
        if (matchesAnyGlob(file, allowed)) continue;
        const around = scopes.filter((scope) => covers(scope, file));
        // A config the rule cannot read may well collect the file: say nothing.
        if (around.some((scope) => scope.kind === 'unreadable')) continue;
        const readable = around.filter((scope) => scope.kind === 'readable');
        if (readable.some((scope) => scopeCollects(scope, file))) continue;
        if (readable.length === 0) {
          if (requireRunner) {
            violations.push({
              file,
              rule: RULE_ID,
              message: `\`${file}\` looks like a test, but no test runner covers its directory, so nothing runs it. Move it under a runner, or declare the runner in \`runners\`.`,
            });
          }
          continue;
        }
        const nearest = readable.reduce((best, scope) => (scope.dir.length > best.dir.length ? scope : best));
        violations.push({
          file,
          rule: RULE_ID,
          message: `\`${file}\` looks like a test, but no runner collects it: ${readable
            .map((scope) => `${scope.runner} (${scope.source}) includes ${scope.include.map((glob) => `\`${glob}\``).join(', ')}`)
            .join('; ')}. It never runs, while checks that only look for a test file pass. Rename it to match \`${
            nearest.include[0] ?? ''
          }\`, or widen the include.`,
        });
      }
      return violations;
    },
  };
}
