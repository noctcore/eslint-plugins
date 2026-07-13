import type { IMetaRule, IViolation } from '@noctcore/harness';

import { dirOf } from './shared';

/**
 * Options for {@link createTestWorkspaceEnrollmentRule}.
 *
 * De-projected from nightcore, which hardcoded the `test:node` script name, a
 * `packages/*` + `apps/sidecar` dir list, and a vitest exclusion set. All are
 * options.
 */
export interface TestWorkspaceEnrollmentOptions {
  /** The root-manifest script that must enumerate every tested package. Default `'test:node'`. */
  readonly scriptName?: string;
  /** The root manifest path. Default `'package.json'`. */
  readonly manifestPath?: string;
  /** `package.json` globs whose dirs are candidate test workspaces. Default `['packages/*\/package.json']`. */
  readonly packageGlobs?: readonly string[];
  /** Extra directories to check beyond the globbed packages. Default `[]`. */
  readonly extraDirs?: readonly string[];
  /** Directories tested by a different runner/script (excluded here). Default `[]`. */
  readonly excludeDirs?: readonly string[];
  /** Glob suffix (relative to a dir) that detects the presence of tests. Default `'**\/*.test.ts'`. */
  readonly testGlobSuffix?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * A test workspace that is not enumerated in the aggregate test script runs in
 * no CI gate. This fails when any candidate package that HAS test files is
 * missing from the configured `scriptName` command in the root manifest.
 */
export function createTestWorkspaceEnrollmentRule(
  options: TestWorkspaceEnrollmentOptions = {},
): IMetaRule {
  const scriptName = options.scriptName ?? 'test:node';
  const manifestPath = options.manifestPath ?? 'package.json';
  const packageGlobs = options.packageGlobs ?? ['packages/*/package.json'];
  const extraDirs = options.extraDirs ?? [];
  const excludeDirs = new Set(options.excludeDirs ?? []);
  const testGlobSuffix = options.testGlobSuffix ?? '**/*.test.ts';
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'test-workspace-enrollment',
    category: 'testing',
    ciCritical,
    description: `Every candidate package with test files must be enumerated in the root '${scriptName}' script.`,
    run(ctx) {
      const root = ctx.read(manifestPath);
      if (root === null) return [];
      let scripts: Record<string, string> = {};
      try {
        scripts = ((JSON.parse(root) as { scripts?: Record<string, string> }).scripts ?? {});
      } catch {
        return [];
      }
      const script = scripts[scriptName] ?? '';
      const violations: IViolation[] = [];
      const dirs = [
        ...packageGlobs.flatMap((g) => ctx.glob(g)).map((p) => dirOf(p)),
        ...extraDirs,
      ];
      for (const dir of dirs) {
        if (excludeDirs.has(dir)) continue;
        const hasTests = ctx.glob(`${dir}/${testGlobSuffix}`).length > 0;
        if (!hasTests) continue;
        if (!script.includes(dir)) {
          violations.push({
            file: manifestPath,
            rule: 'test-workspace-enrollment',
            message: `Package '${dir}' has test files but is not listed in the '${scriptName}' script — its tests run in no CI gate. Add '${dir}' to '${scriptName}'.`,
          });
        }
      }
      return violations;
    },
  };
}
