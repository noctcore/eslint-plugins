import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import { DEFAULT_BASELINE_DIR, isGrandfathered, loadBaseline } from '@noctcore/harness';

import { countLines, recursiveGlobs } from './shared';

/**
 * Options for {@link createFileSizeRatchetRule}.
 *
 * This single factory subsumes BOTH of nightcore's file-size ratchet rules —
 * `web-file-size-ratchet` (apps/web/src, .ts+.tsx) and `engine-file-size-ratchet`
 * (packages/engine/src, .ts) — because they were byte-identical logic differing
 * only in their scanned roots, extensions and exclusions. A consumer creates one
 * instance per capped area. `id` names both the rule and its committed baseline
 * file (`<baselineDir>/<id>.json`), so give each instance a distinct `id`.
 */
export interface FileSizeRatchetOptions {
  /** Rule id AND baseline file basename. Default `'file-size-ratchet'`. */
  readonly id?: string;
  /** Source roots to scan. Default `[]` (inert until configured), e.g. `['apps/web/src']`. */
  readonly roots?: readonly string[];
  /** File extensions to include. Default `['.ts', '.tsx']`. */
  readonly extensions?: readonly string[];
  /** The per-file line cap. Default `400`. */
  readonly cap?: number;
  /** A file is excluded if its path contains any of these. Default test/spec/story markers. */
  readonly excludeContains?: readonly string[];
  /** A file is excluded if its path starts with any of these (e.g. codegen dirs). Default `[]`. */
  readonly excludePrefixes?: readonly string[];
  /** A baseline entry that shrank below `frozen * tightenRatio` must be re-frozen. Default `0.85`. */
  readonly tightenRatio?: number;
  /** Where committed baselines live, relative to repo root. Default {@link DEFAULT_BASELINE_DIR}. */
  readonly baselineDir?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_EXCLUDE_CONTAINS = ['.test.', '.spec.', '.stories.'];

/**
 * File-size governance with a one-way ratchet. Today's over-cap offenders are
 * frozen in a committed baseline; a NEW over-cap file, or a frozen one that
 * GREW, fails. Legacy files may only shrink; new files may never join. The
 * baseline additionally SELF-TIGHTENS: an entry whose file is gone, is now at or
 * below the cap, or shrank far below its frozen value is itself a violation
 * demanding a baseline update — so paydowns are captured and the frozen debt can
 * only shrink.
 *
 * Measured in raw physical lines (`wc -l` semantics) so the number an author
 * sees in the editor is the number the gate sees.
 */
export function createFileSizeRatchetRule(options: FileSizeRatchetOptions = {}): IMetaRule {
  const id = options.id ?? 'file-size-ratchet';
  const roots = options.roots ?? [];
  const extensions = options.extensions ?? ['.ts', '.tsx'];
  const cap = options.cap ?? 400;
  const excludeContains = options.excludeContains ?? DEFAULT_EXCLUDE_CONTAINS;
  const excludePrefixes = options.excludePrefixes ?? [];
  const tightenRatio = options.tightenRatio ?? 0.85;
  const baselineDir = options.baselineDir ?? DEFAULT_BASELINE_DIR;
  const ciCritical = options.ciCritical ?? true;

  function sourceFiles(ctx: IMetaCtx): string[] {
    return recursiveGlobs(roots, extensions)
      .flatMap((pattern) => ctx.glob(pattern))
      .filter(
        (rel) =>
          !excludeContains.some((frag) => rel.includes(frag)) &&
          !excludePrefixes.some((prefix) => rel.startsWith(prefix)),
      )
      .sort();
  }

  /** `<repo-rel> → lines` for every file over the cap. Shared by run + baseline. */
  function currentOffenders(ctx: IMetaCtx): Record<string, number> {
    const map: Record<string, number> = {};
    for (const file of sourceFiles(ctx)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const n = countLines(text);
      if (n > cap) map[file] = n;
    }
    return map;
  }

  return {
    id,
    category: 'source-text',
    ciCritical,
    description: `Source files stay at or under ${cap} raw lines. Today's offenders are grandfathered by ${baselineDir}/${id}.json; a new/grown offender fails, and a stale/shrunk baseline entry demands tightening.`,
    baseline(ctx) {
      return currentOffenders(ctx);
    },
    run(ctx) {
      const baseline = loadBaseline(ctx, id, baselineDir);
      const violations: IViolation[] = [];

      // Over-cap files: grandfathered while within their frozen line count.
      for (const [file, n] of Object.entries(currentOffenders(ctx))) {
        if (isGrandfathered(baseline, file, n)) {
          console.error(
            `[grandfathered] ${id} (${file}): ${n} lines frozen by baseline (cap ${cap}) — split to ratchet down.`,
          );
        } else {
          violations.push({
            file,
            rule: id,
            message: `file exceeds the ${cap}-line cap: ${n} lines. New files never join the baseline and frozen files may not grow — split it.`,
          });
        }
      }

      // Self-tightening: stale or over-generous baseline entries are violations.
      for (const [file, frozen] of Object.entries(baseline)) {
        const text = ctx.read(file);
        if (text === null) {
          violations.push({
            file,
            rule: id,
            message: `baseline entry is stale — the file no longer exists. Remove it and update the baseline.`,
          });
          continue;
        }
        const n = countLines(text);
        if (n <= cap) {
          violations.push({
            file,
            rule: id,
            message: `baseline entry is stale — the file is now within the ${cap}-line cap (${n} lines). Remove it and update the baseline.`,
          });
        } else if (n < frozen * tightenRatio) {
          violations.push({
            file,
            rule: id,
            message: `baseline entry is over-generous — the file shrank below its frozen ${frozen} (now ${n} lines). Tighten it and update the baseline.`,
          });
        }
      }

      return violations;
    },
  };
}
