import path from 'node:path';

/*
 * Minimal, layout-independent helpers shared by this package's rules. These were
 * inlined (rather than depending on `@noctcore/eslint-utils`) so the rules carry
 * only the tiny surface that survives de-projecting: a basename accessor, a
 * dotted-suffix test for the file-role rules, and the React hook-name predicate.
 */

/** Basename of a file path (e.g. `TaskCard.hooks.ts`), separator-agnostic. */
export function getBasename(filename: string): string {
  return path.basename(filename.split('\\').join('/'));
}

/**
 * True when the file's basename ends with any of the given dotted suffixes
 * (`.hooks.ts`, `.queries.ts`, ...). Basename-scoped so a directory that happens
 * to share the suffix never matches, and layout-independent by design.
 */
export function matchesAnySuffix(
  filename: string,
  suffixes: readonly string[],
): boolean {
  const basename = getBasename(filename);
  return suffixes.some((suffix) => basename.endsWith(suffix));
}

/** True for a React hook identifier name (`useThing`). */
export function isHookName(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z]/.test(name);
}
