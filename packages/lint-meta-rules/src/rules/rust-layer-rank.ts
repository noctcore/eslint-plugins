import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from './glob-match';
import { escapeRegExp, globFiles, stripTrailingSlashes, stripYamlComment } from './shared';
import { lineLocator, rustFiles, rustScanText } from './rust-source';

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

/** How far a grouped import (`crate::{ ... }`) is followed when no `;` or closing brace ends it. */
const MAX_GROUP_LENGTH = 4096;
/** Path keywords that never name a module of their own. */
const PATH_KEYWORDS: ReadonlySet<string> = new Set(['crate', 'self', 'super']);

/**
 * The module depth of a file under the crate root: `lib.rs` and `main.rs` are
 * the root (0), `foo.rs` and `foo/mod.rs` are `foo` (1), `foo/bar.rs` is
 * `foo::bar` (2). Binary crate roots, `bin/<name>.rs` and `bin/<name>/main.rs`,
 * are roots too, and the files beside a `bin/<name>/main.rs` count from it. `rel` is the path under the crate's source directory. The
 * depth comes from the path alone, so a module moved with `#[path]` gets the
 * depth of where its file sits.
 */
export function rustModuleDepth(rel: string): number {
  let segments = rel.replace(/\.rs$/u, '').split('/');
  if (segments[0] === 'bin') {
    if (segments.length === 2) return 0;
    // `bin/<name>/main.rs` is the root, so `bin/<name>/args.rs` is depth 1 below it.
    segments = segments.slice(2);
    if (segments.length === 1 && segments[0] === 'main') return 0;
  }
  if (segments[segments.length - 1] === 'mod') segments.pop();
  if (segments.length === 1 && (segments[0] === 'lib' || segments[0] === 'main')) return 0;
  return segments.length;
}

/**
 * The top-level modules a scan text names through `crate::x`, `crate::{x, y::z}`
 * and leading `super::` segments that climb to the crate root, with the offset
 * of each. `depth` is the file's module depth ({@link rustModuleDepth}): from
 * depth 1, `super::ui` is `crate::ui`; a `super::` path that stays below the
 * root stays inside the file's own top-level module and is not returned.
 */
export function crateModuleReferences(scan: string, depth = 0): { name: string; offset: number }[] {
  const out: { name: string; offset: number }[] = [];
  const pattern = /(?<![\w:])(?:crate|((?:super\s*::\s*)*super))\s*::\s*(?:([a-z_][a-z0-9_]*)|\{)/gu;
  for (let match = pattern.exec(scan); match !== null; match = pattern.exec(scan)) {
    const climbs = match[1] === undefined ? depth : (match[1].match(/super/gu) ?? []).length;
    if (climbs !== depth) continue;
    const name = match[2];
    if (name !== undefined) {
      if (!PATH_KEYWORDS.has(name)) out.push({ name, offset: match.index });
      continue;
    }
    // A group: read the first name of each top-level entry, up to its closing brace,
    // a `;`, or a bounded distance, and resume the search after it.
    let braces = 0;
    let expectName = true;
    const open = match.index + match[0].length - 1;
    const limit = Math.min(scan.length, open + MAX_GROUP_LENGTH);
    let index = open;
    for (; index < limit; index += 1) {
      const char = scan[index] ?? '';
      if (char === ';') break;
      if (char === '{') {
        braces += 1;
        expectName = braces === 1;
      } else if (char === '}') {
        braces -= 1;
        if (braces === 0) break;
      } else if (char === ',' && braces === 1) {
        expectName = true;
      } else if (expectName && braces === 1 && /[a-z_]/u.test(char)) {
        let stop = index + 1;
        while (stop < limit && /[a-z0-9_]/u.test(scan[stop] ?? '')) stop += 1;
        const entry = scan.slice(index, stop);
        if (!PATH_KEYWORDS.has(entry)) out.push({ name: entry, offset: index });
        index = stop - 1;
        expectName = false;
      } else if (!/\s/u.test(char)) {
        expectName = false;
      }
    }
    pattern.lastIndex = Math.max(pattern.lastIndex, index + 1);
  }
  return out;
}

/** One dependency entry of a `Cargo.toml`: the crate it pulls in (its `package` when renamed) and the line of its key. */
export interface CargoDependency {
  readonly crate: string;
  readonly line: number;
}

const DEPENDENCY_TABLE = /^\[\s*(?:[^\]]*\.)?(?:dev-|build-)?dependencies\s*\]$/u;
const DEPENDENCY_SUBTABLE = /^\[\s*(?:[^\]]*\.)?(?:dev-|build-)?dependencies\s*\.\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*\]$/u;
const DEPENDENCY_KEY = /^(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*(?:\.\s*[\w-]+\s*)?=\s*(.*)$/u;
const PACKAGE_VALUE = /\bpackage\s*=\s*(?:"([^"]+)"|'([^']+)')/u;

/**
 * The dependency entries of a `Cargo.toml`, read line by line: keys under a
 * `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]` or
 * `[target.<cfg>.dependencies]` table (bare, quoted or dotted as in
 * `acme-db.workspace = true`), and `[dependencies.<name>]` tables. A renamed
 * dependency (`db = { package = "acme-db" }`) counts as the package it names.
 */
export function cargoDependencies(text: string): CargoDependency[] {
  const out: CargoDependency[] = [];
  let inTable = false;
  let subtable: { crate: string; line: number } | null = null;
  const flush = (): void => {
    if (subtable !== null) out.push(subtable);
    subtable = null;
  };
  text.split('\n').forEach((raw, index) => {
    const line = stripYamlComment(raw).trim();
    if (line.startsWith('[')) {
      flush();
      inTable = DEPENDENCY_TABLE.test(line);
      const sub = DEPENDENCY_SUBTABLE.exec(line);
      if (sub !== null) subtable = { crate: sub[1] ?? sub[2] ?? sub[3] ?? '', line: index + 1 };
      return;
    }
    if (subtable !== null) {
      const renamed = /^package\s*=\s*(?:"([^"]+)"|'([^']+)')/u.exec(line);
      if (renamed !== null) subtable = { ...subtable, crate: renamed[1] ?? renamed[2] ?? subtable.crate };
      return;
    }
    if (!inTable) return;
    const key = DEPENDENCY_KEY.exec(line);
    if (key === null) return;
    const renamed = PACKAGE_VALUE.exec(key[4] ?? '');
    out.push({ crate: renamed?.[1] ?? renamed?.[2] ?? key[1] ?? key[2] ?? key[3] ?? '', line: index + 1 });
  });
  flush();
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
    const root = stripTrailingSlashes(opts.root ?? 'src');
    const facades = opts.facades ?? {};
    // Own keys only: a module named `constructor` or `toString` is not a facade.
    const facadeOf = (name: string): string =>
      Object.prototype.hasOwnProperty.call(facades, name) ? (facades[name] ?? name) : name;
    const groups = opts.toleratedGroups ?? [];
    const tolerated = (from: string, to: string): boolean =>
      groups.some((group) => group.includes(from) && group.includes(to));
    const violations: IViolation[] = [];
    for (const file of rustFiles((pattern) => ctx.glob(pattern), [root], exempt)) {
      const rel = file.slice(root.length + 1);
      const from = rel.split('/')[0]?.replace(/\.rs$/u, '') ?? '';
      if (rankOf(from) === undefined && !forbiddenEdges.some((edge) => edge.from === from)) continue;
      const scan = rustScanText(ctx.read(file) ?? '', skipTestModules);
      const lineOf = lineLocator(scan);
      const edges: Edge[] = crateModuleReferences(scan, rustModuleDepth(rel))
        .map(({ name, offset }) => ({ target: facadeOf(name), line: lineOf(offset), kind: 'use' as const }))
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
    const identPrefix = escapeRegExp(prefix.replace(/-/gu, '_'));
    // A path (`acme_db::x`, `::acme_db::x`) or a declaration (`use acme_db;`, `extern crate acme_db`),
    // never a name that is only the crate's prefix (`acme_db_url`) or a submodule (`foo::acme_db`).
    const usePattern = new RegExp(
      `(?<!\\w)(?<!\\w::)(?:(?:use|extern\\s+crate)\\s+(?:::)?${identPrefix}_([a-z0-9_]+)(?![\\w])|${identPrefix}_([a-z0-9_]+)(?=\\s*::))`,
      'gu',
    );
    const crateName = (name: string): string | null =>
      name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : null;
    const violations: IViolation[] = [];

    for (const file of rustFiles((pattern) => ctx.glob(pattern), roots, exempt)) {
      const from = crateOf(file);
      if (from === null) continue;
      const scan = rustScanText(ctx.read(file) ?? '', skipTestModules);
      const lineOf = lineLocator(scan);
      const edges: Edge[] = [...scan.matchAll(usePattern)]
        .map((match) => ({ target: (match[1] ?? match[2] ?? '').replace(/_/gu, '-'), line: lineOf(match.index), kind: 'use' as const }))
        .filter((edge) => edge.target !== from);
      for (const edge of firstEdges(edges)) report(violations, file, from, edge, never, describe);
    }

    for (const file of globFiles((pattern) => ctx.glob(pattern), manifestGlobs)) {
      if (matchesAnyGlob(file, exempt)) continue;
      const from = crateOf(file);
      if (from === null) continue;
      const edges: Edge[] = [];
      for (const dependency of cargoDependencies(ctx.read(file) ?? '')) {
        const target = crateName(dependency.crate);
        if (target !== null) edges.push({ target, line: dependency.line, kind: 'dependency' });
      }
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
