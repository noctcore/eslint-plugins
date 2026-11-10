import { existsSync } from 'node:fs';
import path from 'node:path';

import { globToRegExp, toPosixPath } from './glob';

/*
 * Matching for file-scope options (`allowIn` and friends). ESLint hands a rule
 * the linted file as an absolute path, while people write these globs the way
 * they write flat-config `files`: relative to the project. So a glob is tested
 * against up to three spellings of the file, and any one matching counts:
 *
 *   1. the absolute path, so a `**\/`-anchored glob matches wherever ESLint
 *      was started;
 *   2. the path relative to `context.cwd`, so `apps/server/**` matches
 *      `<cwd>/apps/server/env.ts` like a flat-config `files` glob does;
 *   3. the path relative to the workspace root, so the same glob still matches
 *      when a task runner lints one package at a time and `cwd` is that
 *      package, not the root.
 *
 * A relative spelling is only produced for a file inside that directory, so a
 * relative glob never matches through `..`.
 */

/** Files whose presence marks a workspace root, checked in each ancestor directory. */
export const ROOT_MARKERS: readonly string[] = [
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  '.git',
];

const rootCache = new Map<string, string | null>();

/**
 * The workspace root: the nearest ancestor of `startDir` (itself included)
 * holding one of `ROOT_MARKERS`, or `null` when there is none. Lockfiles are
 * the portable signal, since every package manager writes exactly one at the
 * workspace root; `.git` covers a checkout with no lockfile yet. Cached per
 * start directory.
 */
export function findRepoRoot(startDir: string): string | null {
  const cached = rootCache.get(startDir);
  if (cached !== undefined) {
    return cached;
  }
  let dir = startDir;
  for (;;) {
    if (ROOT_MARKERS.some((marker) => existsSync(path.join(dir, marker)))) {
      rootCache.set(startDir, dir);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      rootCache.set(startDir, null);
      return null;
    }
    dir = parent;
  }
}

/** A Windows drive prefix such as `C:/`, compared without regard to case. */
const DRIVE_PREFIX = /^[A-Za-z]:\//u;

function stripTrailingSlash(dir: string): string {
  return dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/**
 * `file` relative to `dir`, both forward-slashed, or `null` when `file` is not
 * inside `dir`. Pure string work, so Windows paths behave the same on any host.
 */
export function relativeInside(file: string, dir: string): string | null {
  const posixFile = toPosixPath(file);
  const base = stripTrailingSlash(toPosixPath(dir));
  if (base.length === 0) {
    return null;
  }
  const prefix = base === '/' ? '/' : `${base}/`;
  const caseless = DRIVE_PREFIX.test(posixFile) && DRIVE_PREFIX.test(prefix);
  const head = posixFile.slice(0, prefix.length);
  const same = caseless ? head.toLowerCase() === prefix.toLowerCase() : head === prefix;
  if (!same || posixFile.length === prefix.length) {
    return null;
  }
  return posixFile.slice(prefix.length);
}

/**
 * The spellings of `filename` a file-scope glob is tested against: the
 * forward-slashed path as given, then (when the file is inside them) the path
 * relative to `cwd` and to the workspace root. Duplicates are dropped.
 */
export function fileScopeCandidates(filename: string, cwd?: string): string[] {
  const candidates = [toPosixPath(filename)];
  const add = (dir: string | null | undefined): void => {
    if (dir === null || dir === undefined) {
      return;
    }
    const relative = relativeInside(filename, dir);
    if (relative !== null && !candidates.includes(relative)) {
      candidates.push(relative);
    }
  };
  add(cwd);
  if (path.isAbsolute(filename)) {
    add(findRepoRoot(path.dirname(filename)));
  }
  return candidates;
}

/** A leading `./` means "relative to the project", which is what every relative glob already means. */
function normalizeGlob(glob: string): string {
  return glob.startsWith('./') ? glob.slice(2) : glob;
}

/**
 * True when the linted file matches at least one of `globs`. Pass
 * `context.filename` and `context.cwd`: a relative glob such as
 * `apps/server/**` matches the file relative to the working directory or the
 * workspace root, and a `**\/`-anchored glob matches the absolute path. An
 * empty pattern list matches nothing.
 */
export function fileMatchesAnyGlob(filename: string, globs: readonly string[], cwd?: string): boolean {
  if (globs.length === 0) {
    return false;
  }
  const candidates = fileScopeCandidates(filename, cwd);
  return globs.some((glob) => {
    const regex = globToRegExp(normalizeGlob(glob));
    return candidates.some((candidate) => regex.test(candidate));
  });
}
