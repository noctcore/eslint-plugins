import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/*
 * Framework-agnostic path helpers for the folder-per-component architecture
 * rules. The layout these rules assume is `<root>/<feature>/.../<Name>/<Name>.tsx`
 * — a folder-per-component anywhere under a feature directory, with no
 * `features/` segment and no nested root segment. Path logic anchors on a
 * configurable `<root>` directory segment (default `components`) rather than an
 * absolute prefix, so a rule behaves identically whether ESLint runs from the
 * repo root or per-package, and on both POSIX and Windows separators.
 *
 * These were inlined and de-projected from nightcore's
 * `src/utils/component-architecture.ts`: the `components` anchor is now a
 * parameter, and glob matching for `ignorePaths` uses a small built-in matcher
 * (below) instead of `micromatch`, keeping this package dependency-light.
 */

/** Forward-slash a path so separators match regardless of OS. */
export function toPosix(filename: string): string {
  return filename.split(path.sep).join('/').split('\\').join('/');
}

/** Forward-slashed basename of a file (e.g. `TaskCard.tsx`). */
export function getBasename(filename: string): string {
  return path.basename(filename);
}

/** True when the segment is PascalCase (a component folder/name). */
export function isPascalCase(segment: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(segment);
}

/**
 * True for a single PascalCase `.tsx` basename (`TaskCard.tsx`). Sidecars carry
 * an extra dotted segment (`TaskCard.hooks.ts`, `.stories.tsx`, `.test.tsx`)
 * and are excluded, as are kebab-case files. This does not require the
 * folder-per-component layout.
 */
export function isComponentFileName(filename: string): boolean {
  return /^[A-Z][A-Za-z0-9]*\.tsx$/.test(getBasename(filename));
}

/** Component name for a component file (`TaskCard.tsx` -> `TaskCard`). */
export function getComponentName(filename: string): string {
  return getBasename(filename).replace(/\.tsx$/, '');
}

/**
 * True for a component entry file in the folder-per-component layout: a single
 * PascalCase `.tsx` whose basename (sans ext) equals its parent directory's
 * basename (`TaskCard/TaskCard.tsx`).
 */
export function isComponentEntryFile(filename: string): boolean {
  if (!isComponentFileName(filename)) {
    return false;
  }
  return getComponentName(filename) === path.basename(path.dirname(filename));
}

/**
 * The forward-slashed segments after the `<root>/` anchor, or `null` when the
 * file is not under a `<root>/` directory.
 */
function segmentsAfterRoot(filename: string, root: string): readonly string[] | null {
  const marker = `/${root}/`;
  const posix = toPosix(filename);
  const idx = posix.lastIndexOf(marker);
  if (idx === -1) {
    return null;
  }
  return posix
    .slice(idx + marker.length)
    .split('/')
    .filter((segment) => segment.length > 0);
}

/**
 * The feature a file belongs to: the directory segment immediately under
 * `<root>/`, or `null` when the file is not under `<root>/`. For root
 * `components`, `apps/web/src/components/board/TaskCard/TaskCard.tsx` -> `board`.
 */
export function getFeatureName(filename: string, root: string): string | null {
  const segments = segmentsAfterRoot(filename, root);
  if (segments === null || segments.length === 0) {
    return null;
  }
  const feature = segments[0];
  return feature !== undefined && feature.length > 0 ? feature : null;
}

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a glob into an anchored RegExp. Supports the subset the ignore
 * patterns use: `**` (zero or more path segments), `*` (zero or more non-slash
 * chars within a segment), and `?` (a single non-slash char). Dotfiles match
 * (there is no implicit dot exclusion), matching the `{ dot: true }` behavior
 * nightcore configured on micromatch.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more leading segments; a bare `**` matches the rest.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char !== undefined) {
      out += escapeRegExpLiteral(char);
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when the file (forward-slashed) matches one of the ignore globs. */
export function isIgnoredPath(filename: string, ignorePaths: readonly string[]): boolean {
  if (ignorePaths.length === 0) {
    return false;
  }
  const posix = toPosix(filename);
  return ignorePaths.some((glob) => globToRegExp(glob).test(posix));
}

/** True when `sibling` exists on disk in `dir`. Wrapper kept for testability. */
export function siblingExists(dir: string, sibling: string): boolean {
  return existsSync(path.join(dir, sibling));
}

/**
 * The directory's entries as a set. A missing/unreadable directory yields an
 * empty set, so callers treat every expected sibling as absent — matching a
 * per-file `existsSync` sweep.
 */
export function readDirSafe(dir: string): ReadonlySet<string> {
  try {
    return new Set(readdirSync(dir));
  } catch {
    return new Set();
  }
}
