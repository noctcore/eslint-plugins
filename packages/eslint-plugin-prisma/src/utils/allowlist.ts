import { existsSync } from 'node:fs';
import path from 'node:path';

/*
 * File allowlists for the escape-hatch fences.
 *
 * A glob is matched against TWO spellings of the linted file, and either one
 * matching allowlists it:
 *
 *   1. the absolute path, so a pattern with a leading globstar-slash (the
 *      shape every shipped default uses) matches no matter where ESLint was
 *      invoked from;
 *   2. the path relative to the workspace root, so a root-anchored pattern
 *      such as `packages/database/**` still matches when a task runner lints
 *      one package at a time and `context.cwd` is that package, not the root.
 *
 * The workspace root is the nearest ancestor holding one of `ROOT_MARKERS`.
 * Lockfiles are the portable signal: every package manager writes exactly one
 * at the workspace root, and none inside a workspace package. `.git` covers a
 * checkout with no lockfile yet.
 *
 * The matcher is self-contained (no micromatch) to keep the plugin
 * dependency-light, like the rest of the family. It supports `**`, `*`, `?`
 * and `{a,b}`; `*` and `?` match dotfiles too.
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

/**
 * Files that legitimately run outside any request or tenant context, shared as
 * the default allowlist of the escape-hatch rules: seeds populate every tenant
 * before a request exists, migrations are generated SQL, and an isolation spec
 * drives the raw client on purpose to prove scoping works.
 */
export const DEFAULT_SYSTEM_FILES: readonly string[] = [
  '**/prisma/seed.ts',
  '**/*.seed.ts',
  '**/prisma/migrations/**',
  '**/*.isolation.spec.ts',
];

const rootCache = new Map<string, string | null>();

/**
 * The workspace root (nearest ancestor of `startDir` holding a root marker), or
 * `null` when there is none. Exported so rules that read root-relative FILES,
 * not just match globs, resolve the same root.
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

/** Forward-slash a path so globs match on every OS. */
function toPosix(filename: string): string {
  return filename.split(path.sep).join('/');
}

/** Forward-slash path of `filename` relative to the workspace root, or null with no root. */
export function toRepoRelative(filename: string): string | null {
  const absolute = path.resolve(filename);
  const root = findRepoRoot(path.dirname(absolute));
  if (root === null) {
    return null;
  }
  return toPosix(path.relative(root, absolute));
}

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/gu;

function escapeLiteral(text: string): string {
  return text.replace(REGEX_METACHARACTERS, '\\$&');
}

const globCache = new Map<string, RegExp>();

/** Compile a glob to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached !== undefined) {
    return cached;
  }

  let source = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === undefined) {
      break;
    }
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 2;
        // `**/` may match zero leading directories; a bare `**` matches anything.
        if (glob[i] === '/') {
          source += '(?:.*/)?';
          i += 1;
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else if (char === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        source += '\\{';
        i += 1;
      } else {
        const alternatives = glob
          .slice(i + 1, end)
          .split(',')
          .map(escapeLiteral)
          .join('|');
        source += `(?:${alternatives})`;
        i = end + 1;
      }
    } else {
      source += escapeLiteral(char);
      i += 1;
    }
  }

  const compiled = new RegExp(`^${source}$`, 'u');
  globCache.set(glob, compiled);
  return compiled;
}

/**
 * True when the file is covered by one of the allowlist globs, matched against
 * its absolute path and its workspace-root-relative path. An empty pattern list
 * allowlists nothing.
 */
export function isAllowlisted(filename: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const absolute = toPosix(path.resolve(filename));
  const relative = toRepoRelative(filename);
  return patterns.some((pattern) => {
    const regex = globToRegExp(pattern);
    return regex.test(absolute) || (relative !== null && regex.test(relative));
  });
}
