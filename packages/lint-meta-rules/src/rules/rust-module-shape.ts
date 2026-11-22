import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import { isGrandfathered, loadBaseline } from '@noctcore/harness';

import { countRustCodeLines, rustFiles, rustScanText } from './rust-source';

/** Options for {@link createRustModuleShapeRule}. */
export interface RustModuleShapeOptions {
  /** Rule id, and the baseline file name when `baselineDir` is set. Default `'rust-module-shape'`. */
  readonly id?: string;
  /** Directories whose `.rs` files are checked, recursively. Default `['src', 'crates/*\/src']`. */
  readonly roots?: readonly string[];
  /** The most code lines a file may hold (blank, comment and test-module lines excluded). Default `400`. */
  readonly maxCodeLines?: number;
  /** Above this many code lines, and at or under the cap, the harness logs an advisory line; never a violation. Default off. */
  readonly advisoryCodeLines?: number;
  /** The file name that must stay a manifest. Default `'mod.rs'`. */
  readonly manifestFile?: string;
  /** Item keywords that make a manifest implement rather than declare. Default `fn`, `impl`, `struct`, `enum`, `union`, `trait`, `const`, `static`, `type`, `macro_rules!`. */
  readonly manifestItems?: readonly string[];
  /** Leave `#[cfg(test)] mod` blocks out of the line count and the manifest check. Default `true`. */
  readonly skipTestModules?: boolean;
  /** Globs of files left out of both checks (generated code, a deliberately whole file, `**\/tests.rs`). Default `[]`. */
  readonly exclude?: readonly string[];
  /**
   * Where a ratchet baseline lives, relative to the repo root. When set, today's offenders recorded in
   * `<baselineDir>/<id>.json` (keys `size:<file>` and `manifest:<file>`) pass while they do not grow.
   * Default: no baseline.
   */
  readonly baselineDir?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ROOTS = ['src', 'crates/*/src'] as const;
const DEFAULT_MANIFEST_ITEMS = [
  'fn',
  'impl',
  'struct',
  'enum',
  'union',
  'trait',
  'const',
  'static',
  'type',
  'macro_rules!',
] as const;

/** One top-level item that a manifest should not hold. */
export interface ManifestOffense {
  /** 1-based line. */
  readonly line: number;
  readonly keyword: string;
}

function itemPattern(keywords: readonly string[]): RegExp {
  const words = keywords.filter((keyword) => keyword !== 'macro_rules!').map((keyword) => `${keyword}\\b`);
  if (keywords.includes('macro_rules!')) words.push('macro_rules!');
  // Visibility and the qualifiers an item may carry before its keyword.
  return new RegExp(
    `^(?:pub(?:\\([^)]*\\))?\\s+)?(?:default\\s+)?(?:const\\s+(?=fn\\b|unsafe\\b|async\\b|extern\\b))?(?:async\\s+)?(?:unsafe\\s+)?(?:extern\\s+(?:"[^"]*"\\s+)?(?=fn\\b))?(${words.join('|')})`,
    'u',
  );
}

/**
 * The top-level items of a manifest that implement something: an item keyword
 * at brace depth 0, after comments, literals and (optionally) test modules are
 * blanked. `mod` and `use` declarations, attributes and docs are allowed.
 */
export function manifestOffenses(
  text: string,
  options: { readonly manifestItems?: readonly string[]; readonly skipTestModules?: boolean } = {},
): ManifestOffense[] {
  const pattern = itemPattern(options.manifestItems ?? DEFAULT_MANIFEST_ITEMS);
  const offenses: ManifestOffense[] = [];
  let depth = 0;
  rustScanText(text, options.skipTestModules ?? true)
    .split('\n')
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (depth === 0 && trimmed !== '') {
        const match = pattern.exec(trimmed);
        if (match !== null) offenses.push({ line: index + 1, keyword: match[1] ?? '' });
      }
      for (const char of line) {
        if (char === '{') depth += 1;
        else if (char === '}') depth = Math.max(0, depth - 1);
      }
    });
  return offenses;
}

/**
 * Rust module shape: no file holds more than `maxCodeLines` code lines, and a
 * `mod.rs` is a manifest that declares submodules and re-exports them rather
 * than implementing anything. Text only; never runs cargo.
 */
export function createRustModuleShapeRule(options: RustModuleShapeOptions = {}): IMetaRule {
  const id = options.id ?? 'rust-module-shape';
  const roots = options.roots ?? DEFAULT_ROOTS;
  const maxCodeLines = options.maxCodeLines ?? 400;
  const advisoryCodeLines = options.advisoryCodeLines;
  const manifestFile = options.manifestFile ?? 'mod.rs';
  const manifestItems = options.manifestItems ?? DEFAULT_MANIFEST_ITEMS;
  const skipTestModules = options.skipTestModules ?? true;
  const exclude = options.exclude ?? [];
  const baselineDir = options.baselineDir;
  const ciCritical = options.ciCritical ?? true;

  const isManifest = (file: string): boolean => file === manifestFile || file.endsWith(`/${manifestFile}`);

  interface Finding {
    readonly file: string;
    readonly key: string;
    readonly metric: number;
    readonly violation: IViolation;
  }

  function findings(ctx: IMetaCtx): Finding[] {
    const out: Finding[] = [];
    for (const file of rustFiles((pattern) => ctx.glob(pattern), roots, exclude)) {
      const text = ctx.read(file);
      if (text === null) continue;
      if (isManifest(file)) {
        const offenses = manifestOffenses(text, { manifestItems, skipTestModules });
        const first = offenses[0];
        if (first !== undefined) {
          const where = offenses.map((offense) => `${offense.keyword}@${String(offense.line)}`).join(', ');
          out.push({
            file,
            key: `manifest:${file}`,
            metric: offenses.length,
            violation: {
              file,
              rule: id,
              line: first.line,
              message: `line ${String(first.line)}: ${manifestFile} is a manifest but holds ${String(offenses.length)} top-level item(s) that belong in sibling files, re-exported from it: ${where}. Only mod and use declarations, docs and attributes belong in a ${manifestFile}.`,
            },
          });
        }
      }
      const code = countRustCodeLines(text, skipTestModules);
      if (code > maxCodeLines) {
        out.push({
          file,
          key: `size:${file}`,
          metric: code,
          violation: {
            file,
            rule: id,
            message: `${String(code)} code lines exceeds the ${String(maxCodeLines)}-line cap (blank, comment${skipTestModules ? ' and #[cfg(test)] module' : ''} lines excluded). Split the module into siblings under a thin ${manifestFile}.`,
          },
        });
      } else if (advisoryCodeLines !== undefined && code > advisoryCodeLines) {
        console.error(`[advisory] ${id} (${file}): ${String(code)} code lines, approaching the ${String(maxCodeLines)}-line cap.`);
      }
    }
    return out;
  }

  const rule: IMetaRule = {
    id,
    category: 'source-text',
    ciCritical,
    description: `Rust files stay at or under ${String(maxCodeLines)} code lines, and every ${manifestFile} only declares and re-exports modules.`,
    run(ctx) {
      const all = findings(ctx);
      if (baselineDir === undefined) return all.map((finding) => finding.violation);
      const baseline = loadBaseline(ctx, id, baselineDir);
      const violations: IViolation[] = [];
      for (const finding of all) {
        if (isGrandfathered(baseline, finding.key, finding.metric)) {
          console.error(`[grandfathered] ${id} (${finding.file}): ${finding.key.split(':')[0] ?? ''} ${String(finding.metric)} frozen by baseline.`);
        } else {
          violations.push(finding.violation);
        }
      }
      return violations;
    },
  };
  if (baselineDir !== undefined) {
    rule.baseline = (ctx) => Object.fromEntries(findings(ctx).map((finding) => [finding.key, finding.metric]));
  }
  return rule;
}
