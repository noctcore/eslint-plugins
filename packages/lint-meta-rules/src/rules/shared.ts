/**
 * Small, dependency-free helpers shared across the ported lint-meta rules.
 * Kept deliberately tiny so the harness export pipeline can inline a rule and,
 * at most, a couple of these functions without dragging in a util graph.
 */

/** Strip a trailing `/<basename>` (e.g. `/package.json`) to get the directory. */
export function dirOf(rel: string, basename = 'package.json'): string {
  return rel.replace(new RegExp(`/${escapeRegExp(basename)}$`), '');
}

/** The last non-empty path segment of a `/`-joined path. */
export function baseName(pathLike: string): string {
  const parts = pathLike.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pathLike;
}

/** Escape a string so it can be embedded literally inside a `RegExp`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Raw physical line count, `wc -l` semantics (a trailing newline adds no line). */
export function countLines(text: string): number {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/** Expand `roots × extensions` into `${root}/**\/*${ext}` recursive globs. */
export function recursiveGlobs(roots: readonly string[], extensions: readonly string[]): string[] {
  return roots.flatMap((root) => extensions.map((ext) => `${root}/**/*${ext}`));
}
