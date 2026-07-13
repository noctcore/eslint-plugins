import type { IMetaRule, IViolation } from '@noctcore/harness';

/**
 * Options for {@link createCanonicalHelpersSingleHomeRule}.
 *
 * De-projected from nightcore, which hardcoded `apps/web/src/**\/*.utils.ts` and
 * a `/lib/` exclusion. `include` selects the helper homes to compare;
 * `excludeContains` drops paths containing any listed fragment.
 */
export interface CanonicalHelpersSingleHomeOptions {
  /** Globs of helper-home files to scan for duplicate exports. Default `['apps/web/src/**\/*.utils.ts']`. */
  readonly include?: readonly string[];
  /** Drop any matched path containing one of these fragments. Default `['/lib/']`. */
  readonly excludeContains?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

// Extract top-level exported identifiers (functions, consts, and re-exports).
const EXPORT_DECL_RE =
  /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{\s*([^}]+?)\s*\}/g;

function extractExportedNames(content: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  EXPORT_DECL_RE.lastIndex = 0;
  while ((m = EXPORT_DECL_RE.exec(content)) !== null) {
    if (m[1] !== undefined) names.add(m[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(content)) !== null) {
    const list = m[1] ?? '';
    for (const part of list.split(',')) {
      const ident = part.trim().split(/\s+as\s+/i)[0]?.trim() ?? '';
      if (/^[A-Za-z_$]/.test(ident)) names.add(ident);
    }
  }
  return Array.from(names);
}

/**
 * Pure helpers must live in one canonical home. When the helper-home pattern is
 * adopted, a duplicate exported helper name (the same symbol exported from 2+
 * different home files) is flagged so the helper stays consolidated. Strict, no
 * baseline.
 */
export function createCanonicalHelpersSingleHomeRule(
  options: CanonicalHelpersSingleHomeOptions = {},
): IMetaRule {
  const include = options.include ?? ['apps/web/src/**/*.utils.ts'];
  const excludeContains = options.excludeContains ?? ['/lib/'];
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'canonical-helpers-single-home',
    category: 'source-text',
    ciCritical,
    description:
      'Pure helpers must live in one canonical home (flag the same exported symbol appearing in multiple homes).',
    run(ctx) {
      const violations: IViolation[] = [];
      const files = include
        .flatMap((g) => ctx.glob(g))
        .filter((f) => !excludeContains.some((frag) => f.includes(frag)));
      const nameToHomes: Record<string, string[]> = {};
      for (const file of files) {
        const content = ctx.read(file) ?? '';
        for (const name of extractExportedNames(content)) {
          (nameToHomes[name] ??= []).push(file);
        }
      }
      for (const [name, homes] of Object.entries(nameToHomes)) {
        const first = homes[0];
        if (homes.length > 1 && first !== undefined) {
          violations.push({
            file: first,
            rule: 'canonical-helpers-single-home',
            message: `Helper '${name}' lives in multiple homes (${homes.join(', ')}) — consolidate to the canonical one.`,
          });
        }
      }
      return violations;
    },
  };
}
