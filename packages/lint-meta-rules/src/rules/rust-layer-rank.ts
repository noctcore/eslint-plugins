import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from './glob-match';
import { escapeRegExp, globFiles, stripYamlComment } from './shared';
import { lineAt, rustFiles, rustScanText } from './rust-source';

/** An edge that is reported whatever the ranks say, with the message to show. */
export interface RustForbiddenEdge {
  readonly from: string;
  readonly to: string;
  /** Shown instead of the generic message, for example the seam the edge should go through. */
  readonly message?: string;
}

interface RustLayerRankCommon {
  /** Rule id. Default `'rust-layer-rank'`. */
  readonly id?: string;
  /** Layer name to rank. A layer may reference only layers of a strictly lower rank. Unranked layers are skipped. Default `{}` (inert). */
  readonly ranks?: Readonly<Record<string, number>>;
  /** Edges reported even when the ranks allow or tolerate them. Default `[]`. */
  readonly forbiddenEdges?: readonly RustForbiddenEdge[];
  /** Globs of files never checked as the importing side. Default `[]`. */
  readonly exempt?: readonly string[];
  /** Leave `#[cfg(test)] mod` blocks out of the scan. Default `true`. */
  readonly skipTestModules?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/** `module` mode: rank the top-level modules of one crate from `use crate::<module>` paths. */
export interface RustModuleRankOptions extends RustLayerRankCommon {
  readonly mode?: 'module';
  /** The crate's source directory; a file's layer is its first path segment under it. Default `'src'`. */
  readonly root?: string;
  /** Crate-root re-export aliases mapped to the module they come from (`settings` to `store`). Default `{}`. */
  readonly facades?: Readonly<Record<string, string>>;
  /** Groups of equal-rank modules allowed to import each other (a known cycle). Default `[]`. */
  readonly toleratedGroups?: readonly (readonly string[])[];
}

/** `crate` mode: rank the crates of a workspace from `<prefix>_<crate>` paths and `<prefix>-<crate>` dependencies. */
export interface RustCrateRankOptions extends RustLayerRankCommon {
  readonly mode: 'crate';
  /** The shared crate name prefix: `acme` ranks `acme-db` from `acme_db::` paths and `acme-db` dependencies. */
  readonly cratePrefix: string;
  /** Directories whose `.rs` files are scanned. Default `['crates']`. */
  readonly roots?: readonly string[];
  /** `Cargo.toml` files whose dependency entries are checked. Default `['crates/*\/Cargo.toml']`. */
  readonly manifestGlobs?: readonly string[];
  /** Path prefix to crate name for crates outside `crates/<prefix>-<name>/`, for example `{ 'apps/desktop/': 'desktop' }`. Default `{}`. */
  readonly crateDirs?: Readonly<Record<string, string>>;
}

/** Options for {@link createRustLayerRankRule}: `module` mode (the default) or `crate` mode. */
export type RustLayerRankOptions = RustModuleRankOptions | RustCrateRankOptions;

interface Edge {
  readonly target: string;
  readonly line: number;
  readonly kind: 'use' | 'dependency';
}

/** The top-level modules a scan text names through `crate::x` and `crate::{x, y::z}`, with the line of each. */
export function crateModuleReferences(scan: string): { name: string; offset: number }[] {
  const out: { name: string; offset: number }[] = [];
  for (const match of scan.matchAll(/\bcrate::(?:([a-z_][a-z0-9_]*)|\{)/gu)) {
    const offset = match.index;
    if (match[1] !== undefined) {
      out.push({ name: match[1], offset });
      continue;
    }
    let depth = 0;
    let expectName = true;
    for (let index = offset + match[0].length - 1; index < scan.length; index += 1) {
      const char = scan[index] ?? '';
      if (char === '{') {
        depth += 1;
        expectName = depth === 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === ',' && depth === 1) {
        expectName = true;
      } else if (expectName && depth === 1 && /[a-z_]/u.test(char)) {
        const name = /^[a-z_][a-z0-9_]*/u.exec(scan.slice(index))?.[0] ?? '';
        if (name !== 'self') out.push({ name, offset: index });
        index += name.length - 1;
        expectName = false;
      } else if (!/\s/u.test(char)) {
        expectName = false;
      }
    }
  }
  return out;
}

function forbiddenEdgeMessage(edges: readonly RustForbiddenEdge[], from: string, to: string): RustForbiddenEdge | undefined {
  return edges.find((edge) => edge.from === from && edge.to === to);
}

/**
 * A fixed dependency direction for Rust code, checked from text: a layer may
 * reference only layers of a strictly lower rank. In `module` mode the layers
 * are the top-level modules of one crate, read from `crate::` paths after
 * resolving facade aliases; in `crate` mode they are the crates of a
 * workspace, read from `<prefix>_<crate>` paths and `<prefix>-<crate>` entries
 * in `Cargo.toml`. Comments, string contents and test modules are not read.
 */
export function createRustLayerRankRule(options: RustLayerRankOptions = {}): IMetaRule {
  const id = options.id ?? 'rust-layer-rank';
  const ranks = options.ranks ?? {};
  const forbiddenEdges = options.forbiddenEdges ?? [];
  const exempt = options.exempt ?? [];
  const skipTestModules = options.skipTestModules ?? true;
  const ciCritical = options.ciCritical ?? true;
  const rankOf = (layer: string): number | undefined =>
    Object.prototype.hasOwnProperty.call(ranks, layer) ? ranks[layer] : undefined;

  function report(
    violations: IViolation[],
    file: string,
    from: string,
    edge: Edge,
    tolerated: (from: string, to: string) => boolean,
    describe: (layer: string) => string,
  ): void {
    const forbidden = forbiddenEdgeMessage(forbiddenEdges, from, edge.target);
    const at = `line ${String(edge.line)}: `;
    if (forbidden !== undefined) {
      violations.push({
        file,
        rule: id,
        line: edge.line,
        message: `${at}${forbidden.message ?? `${describe(from)} must not reference ${describe(edge.target)}: the edge is forbidden.`}`,
      });
      return;
    }
    const fromRank = rankOf(from);
    const toRank = rankOf(edge.target);
    if (fromRank === undefined || toRank === undefined || toRank < fromRank || tolerated(from, edge.target)) return;
    const kind = toRank === fromRank ? 'sideways' : 'upward';
    const via = edge.kind === 'use' ? 'reference' : 'dependency';
    violations.push({
      file,
      rule: id,
      line: edge.line,
      message: `${at}forbidden ${kind} ${via}: ${describe(from)} (rank ${String(fromRank)}) on ${describe(edge.target)} (rank ${String(toRank)}). A layer may depend only on strictly lower-ranked layers: invert the dependency or move the shared code down a rank.`,
    });
  }

  /** One violation per file and target: the first edge to it. */
  function firstEdges(edges: readonly Edge[]): Edge[] {
    const seen = new Set<string>();
    return edges.filter((edge) => {
      if (seen.has(edge.target)) return false;
      seen.add(edge.target);
      return true;
    });
  }

  function runModule(ctx: IMetaCtx, opts: RustModuleRankOptions): IViolation[] {
    const root = (opts.root ?? 'src').replace(/\/+$/u, '');
    const facades = opts.facades ?? {};
    const groups = opts.toleratedGroups ?? [];
    const tolerated = (from: string, to: string): boolean =>
      groups.some((group) => group.includes(from) && group.includes(to));
    const violations: IViolation[] = [];
    for (const file of rustFiles((pattern) => ctx.glob(pattern), [root], exempt)) {
      const from = file.slice(root.length + 1).split('/')[0]?.replace(/\.rs$/u, '') ?? '';
      if (rankOf(from) === undefined && !forbiddenEdges.some((edge) => edge.from === from)) continue;
      const scan = rustScanText(ctx.read(file) ?? '', skipTestModules);
      const edges: Edge[] = crateModuleReferences(scan)
        .map(({ name, offset }) => ({ target: facades[name] ?? name, line: lineAt(scan, offset), kind: 'use' as const }))
        .filter((edge) => edge.target !== from);
      for (const edge of firstEdges(edges)) report(violations, file, from, edge, tolerated, (layer) => layer);
    }
    return violations;
  }

  function runCrate(ctx: IMetaCtx, opts: RustCrateRankOptions): IViolation[] {
    const prefix = opts.cratePrefix;
    const roots = opts.roots ?? ['crates'];
    const manifestGlobs = opts.manifestGlobs ?? ['crates/*/Cargo.toml'];
    const crateDirs = Object.entries(opts.crateDirs ?? {});
    const dirPattern = new RegExp(`(?:^|/)crates/${escapeRegExp(prefix)}-([a-z0-9-]+)/`, 'u');
    const crateOf = (file: string): string | null =>
      dirPattern.exec(file)?.[1] ?? crateDirs.find(([dir]) => file.startsWith(dir))?.[1] ?? null;
    const describe = (layer: string): string =>
      crateDirs.some(([, name]) => name === layer) ? layer : `${prefix}-${layer}`;
    const never = (): boolean => false;
    const usePattern = new RegExp(`\\b${escapeRegExp(prefix.replace(/-/gu, '_'))}_([a-z0-9_]+)\\b`, 'gu');
    const depPattern = new RegExp(`^\\s*${escapeRegExp(prefix)}-([a-z0-9-]+)\\s*[=.]`, 'u');
    const violations: IViolation[] = [];

    for (const file of rustFiles((pattern) => ctx.glob(pattern), roots, exempt)) {
      const from = crateOf(file);
      if (from === null) continue;
      const scan = rustScanText(ctx.read(file) ?? '', skipTestModules);
      const edges: Edge[] = [...scan.matchAll(usePattern)]
        .map((match) => ({ target: (match[1] ?? '').replace(/_/gu, '-'), line: lineAt(scan, match.index), kind: 'use' as const }))
        .filter((edge) => edge.target !== from);
      for (const edge of firstEdges(edges)) report(violations, file, from, edge, never, describe);
    }

    for (const file of globFiles((pattern) => ctx.glob(pattern), manifestGlobs)) {
      if (matchesAnyGlob(file, exempt)) continue;
      const from = crateOf(file);
      if (from === null) continue;
      const edges: Edge[] = [];
      (ctx.read(file) ?? '').split('\n').forEach((line, index) => {
        const match = depPattern.exec(stripYamlComment(line));
        if (match !== null) edges.push({ target: match[1] ?? '', line: index + 1, kind: 'dependency' });
      });
      for (const edge of firstEdges(edges.filter((candidate) => candidate.target !== from))) {
        report(violations, file, from, edge, never, describe);
      }
    }
    return violations;
  }

  return {
    id,
    category: 'source-text',
    ciCritical,
    description:
      options.mode === 'crate'
        ? 'A crate may depend only on crates of a strictly lower rank, read from Rust paths and Cargo.toml dependencies.'
        : 'A Rust module may import (crate::x) only strictly lower-ranked modules, with facade aliases resolved and test modules skipped.',
    run(ctx) {
      return options.mode === 'crate' ? runCrate(ctx, options) : runModule(ctx, options);
    },
  };
}
