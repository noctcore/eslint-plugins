import type { IMetaRule, IViolation } from '@noctcore/harness';

/**
 * Options for {@link createTestSiblingEnforcementRule}.
 *
 * De-projected from nightcore, which hardcoded `apps/web/src/**\/*.utils.ts` and
 * the `.utils.test.ts(x)` sibling shape. `include` selects which source files
 * must be tested; `testExtensions` are the accepted colocated-test suffixes.
 */
export interface TestSiblingEnforcementOptions {
  /** Globs of source files that must ship a colocated test. Default `['apps/web/src/**\/*.utils.ts']`. */
  readonly include?: readonly string[];
  /** Accepted colocated-test extensions (replace the source `.ts`/`.tsx`). Default `['.test.ts', '.test.tsx']`. */
  readonly testExtensions?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * Every source file matched by `include` must have a colocated sibling test.
 * Modelled on nightcore's `.utils.ts → .utils.test.ts(x)` rule and generalized:
 * for a matched file, the sibling is the same path with its `.ts`/`.tsx`
 * extension replaced by each configured test extension. Strict (no baseline) —
 * the pattern is opt-in via which files match `include`.
 */
export function createTestSiblingEnforcementRule(
  options: TestSiblingEnforcementOptions = {},
): IMetaRule {
  const include = options.include ?? ['apps/web/src/**/*.utils.ts'];
  const testExtensions = options.testExtensions ?? ['.test.ts', '.test.tsx'];
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'test-sibling-enforcement',
    category: 'source-text',
    ciCritical,
    description:
      'Every source file matched by `include` must have a colocated sibling test. Pure helpers must ship a test.',
    run(ctx) {
      const violations: IViolation[] = [];
      for (const file of include.flatMap((g) => ctx.glob(g))) {
        const base = file.replace(/\.tsx?$/, '');
        const siblings = testExtensions.map((ext) => `${base}${ext}`);
        if (!siblings.some((sib) => ctx.exists(sib))) {
          violations.push({
            file,
            rule: 'test-sibling-enforcement',
            message: `'${file}' is missing a colocated sibling test (${siblings.join(' or ')}). Pure helpers must ship a colocated test.`,
          });
        }
      }
      return violations;
    },
  };
}
