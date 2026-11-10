import path from 'node:path';

import { fileMatchesAnyGlob, findRepoRoot, globToRegExp, ROOT_MARKERS, toPosixPath } from '@noctcore/eslint-utils';

/*
 * File allowlists for the escape-hatch fences.
 *
 * Matching is shared with the other plugins through `@noctcore/eslint-utils`
 * (`fileMatchesAnyGlob`). A glob is matched against the absolute path, the path
 * relative to `context.cwd`, and the path relative to the workspace root, and
 * any one matching allowlists the file. So a `**\/`-anchored pattern (the shape
 * every shipped default uses) matches wherever ESLint was started, and a
 * root-anchored pattern such as `packages/database/**` still matches when a
 * task runner lints one package at a time and `context.cwd` is that package.
 *
 * The workspace root is the nearest ancestor holding one of `ROOT_MARKERS`.
 */

// The root lookup is shared too; re-exported for the rules that read
// root-relative files, not just match globs.
export { findRepoRoot, globToRegExp, ROOT_MARKERS };

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

/** Forward-slash path of `filename` relative to the workspace root, or null with no root. */
export function toRepoRelative(filename: string): string | null {
  const absolute = path.resolve(filename);
  const root = findRepoRoot(path.dirname(absolute));
  if (root === null) {
    return null;
  }
  return toPosixPath(path.relative(root, absolute));
}

/**
 * True when the file is covered by one of the allowlist globs, matched against
 * its absolute path and its cwd- and workspace-root-relative paths. An empty
 * pattern list allowlists nothing.
 */
export function isAllowlisted(filename: string, patterns: readonly string[], cwd?: string): boolean {
  return fileMatchesAnyGlob(path.resolve(filename), patterns, cwd);
}
