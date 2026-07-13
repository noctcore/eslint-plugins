import type { IMetaRule, IViolation } from '@noctcore/harness';

import { dirOf, escapeRegExp } from './shared';

/**
 * Options for {@link createTestRunnerSegregationRule}.
 *
 * De-projected from nightcore, which hardcoded `bun:test` vs `vitest`, the
 * `packages/*` + `apps/sidecar` bun set and the `apps/web` + `eslint-plugin`
 * vitest set. The two runner import specifiers and the dir groups are options.
 */
export interface TestRunnerSegregationOptions {
  /** `package.json` globs whose dirs default to the bun runner. Default `['packages/*\/package.json']`. */
  readonly bunPackageGlobs?: readonly string[];
  /** Extra bun-runner directories beyond the globbed packages. Default `[]`. */
  readonly bunExtraDirs?: readonly string[];
  /** Directories that use the foreign (non-bun) runner. Default `[]`. */
  readonly vitestDirs?: readonly string[];
  /** The bun-side runner import specifier. Default `'bun:test'`. */
  readonly bunRunnerImport?: string;
  /** The foreign runner import specifier. Default `'vitest'`. */
  readonly foreignRunnerImport?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * The test runner is segregated by workspace and never mixed within a package.
 * Bun-side test files must import the bun runner and never the foreign one;
 * foreign-side test files must never import the bun runner (they may pull the
 * foreign runner in transitively via shared test-utils, so a direct import is
 * not required).
 */
export function createTestRunnerSegregationRule(
  options: TestRunnerSegregationOptions = {},
): IMetaRule {
  const bunPackageGlobs = options.bunPackageGlobs ?? ['packages/*/package.json'];
  const bunExtraDirs = options.bunExtraDirs ?? [];
  const vitestDirs = options.vitestDirs ?? [];
  const bunRunnerImport = options.bunRunnerImport ?? 'bun:test';
  const foreignRunnerImport = options.foreignRunnerImport ?? 'vitest';
  const ciCritical = options.ciCritical ?? true;

  const importRe = (spec: string) => new RegExp(`from\\s+['"]${escapeRegExp(spec)}['"]`);
  const bunRe = importRe(bunRunnerImport);
  const foreignRe = importRe(foreignRunnerImport);

  return {
    id: 'test-runner-segregation',
    category: 'testing',
    ciCritical,
    description: `Bun-side packages use '${bunRunnerImport}'; foreign-side packages use '${foreignRunnerImport}'. Never mix runners.`,
    run(ctx) {
      const violations: IViolation[] = [];
      const vitestSet = new Set(vitestDirs);
      const pkgDirs = bunPackageGlobs.flatMap((g) => ctx.glob(g)).map((p) => dirOf(p));
      const bunDirs = [...pkgDirs.filter((d) => !vitestSet.has(d)), ...bunExtraDirs];

      const testsIn = (dir: string) => [
        ...ctx.glob(`${dir}/**/*.test.ts`),
        ...ctx.glob(`${dir}/**/*.test.tsx`),
      ];

      for (const dir of bunDirs) {
        for (const f of testsIn(dir)) {
          const body = ctx.read(f) ?? '';
          if (foreignRe.test(body)) {
            violations.push({
              file: f,
              rule: 'test-runner-segregation',
              message: `Bun-side test imports '${foreignRunnerImport}' — use '${bunRunnerImport}'.`,
            });
          }
          if (!bunRe.test(body)) {
            violations.push({
              file: f,
              rule: 'test-runner-segregation',
              message: `Bun-side test must import its runner from '${bunRunnerImport}'.`,
            });
          }
        }
      }
      for (const dir of vitestDirs) {
        for (const f of testsIn(dir)) {
          const body = ctx.read(f) ?? '';
          if (bunRe.test(body)) {
            violations.push({
              file: f,
              rule: 'test-runner-segregation',
              message: `Foreign-side test imports '${bunRunnerImport}' — use '${foreignRunnerImport}'.`,
            });
          }
        }
      }
      return violations;
    },
  };
}
