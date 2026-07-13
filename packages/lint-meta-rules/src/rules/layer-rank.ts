import type { IMetaRule, IViolation } from '@noctcore/harness';

import { escapeRegExp } from './shared';

/**
 * Options for {@link createLayerRankRule}.
 *
 * De-projected from nightcore, which hardcoded a fixed rank table
 * (contracts → shared → storage/skills → engine → surfaces) and the `@nightcore`
 * scope. The `ranks` table, `scope`, and the surface tier are all options.
 *
 * `ranks` defaults to `{}`, which makes the rule INERT (no package is ranked, so
 * nothing is forbidden) until a consumer supplies its own layering — the same
 * "off until you opt in" discipline the ESLint monorepo rules use.
 */
export interface LayerRankOptions {
  /** npm scope of workspace packages. Default `'@nightcore'`. */
  readonly scope?: string;
  /** Layer package name → rank. Higher-ranked may import only strictly-lower. Default `{}`. */
  readonly ranks?: Readonly<Record<string, number>>;
  /** Path prefix marking a deployable surface. Default `'apps/'`. */
  readonly surfacePrefix?: string;
  /** Rank assigned to surface files. Omit to leave surfaces unranked (skipped). */
  readonly surfaceRank?: number;
  /** Regex (source) extracting the layer name from a file path. Default `'^packages/([^/]+)/'`. */
  readonly packageDirPattern?: string;
  /** Globs of source files to scan. Default packages + apps `src/**` `.ts`/`.tsx`. */
  readonly sourceGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_SOURCE_GLOBS = [
  'packages/*/src/**/*.ts',
  'packages/*/src/**/*.tsx',
  'apps/*/src/**/*.ts',
  'apps/*/src/**/*.tsx',
];

/**
 * Layer ranks encode a fixed dependency direction: a module may import only
 * STRICTLY-lower-ranked `<scope>` packages; equal (sideways) or higher (upward)
 * is forbidden. Unranked `<scope>` packages are leaf utilities outside the
 * documented spine — an import of one is skipped, and a module living in one is
 * skipped, so the rule never produces a false positive on a package whose tier
 * is not fixed.
 */
export function createLayerRankRule(options: LayerRankOptions = {}): IMetaRule {
  const scope = options.scope ?? '@nightcore';
  const ranks = options.ranks ?? {};
  const surfacePrefix = options.surfacePrefix ?? 'apps/';
  const surfaceRank = options.surfaceRank;
  const dirPattern = new RegExp(options.packageDirPattern ?? '^packages/([^/]+)/');
  const sourceGlobs = options.sourceGlobs ?? DEFAULT_SOURCE_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  const importRe = new RegExp(`from\\s+['"]${escapeRegExp(scope)}\\/([a-z0-9-]+)`, 'g');

  function importerRank(rel: string): number | null {
    if (surfaceRank !== undefined && rel.startsWith(surfacePrefix)) return surfaceRank;
    const m = dirPattern.exec(rel);
    const key = m?.[1];
    if (key === undefined) return null;
    return ranks[key] ?? null;
  }

  return {
    id: 'layer-rank',
    category: 'source-text',
    ciCritical,
    description:
      'Fixed dependency direction by rank: a module imports only strictly-lower-ranked <scope> packages (equal/upward forbidden).',
    run(ctx) {
      const violations: IViolation[] = [];
      const files = sourceGlobs.flatMap((g) => ctx.glob(g));
      for (const f of files) {
        if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
        const fromRank = importerRank(f);
        if (fromRank === null) continue;
        const body = ctx.read(f) ?? '';
        for (const m of body.matchAll(importRe)) {
          const target = m[1];
          if (target === undefined) continue;
          const toRank = ranks[target];
          if (toRank === undefined) continue; // Unranked leaf util.
          if (toRank >= fromRank) {
            const kind = toRank === fromRank ? 'sideways' : 'upward';
            violations.push({
              file: f,
              rule: 'layer-rank',
              message: `Forbidden ${kind} import: ${scope}/${target} (rank ${toRank}) from a rank-${fromRank} module. A module may import only strictly-lower-ranked ${scope} packages. Add a façade/bridge seam instead of a new edge.`,
            });
          }
        }
      }
      return violations;
    },
  };
}
