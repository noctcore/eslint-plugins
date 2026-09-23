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

/** Default workflow globs: every `.github/workflows/*.y(a)ml`. */
export const DEFAULT_WORKFLOW_GLOBS: readonly string[] = [
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
];

/** Directories no CI or Docker file lives in (dependencies, build output, VCS internals). */
export const DEFAULT_SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  'coverage',
];

/**
 * The deduplicated, sorted union of `globs`, minus any path with a segment in
 * `skipDirs`. Sorted so violations come out in a stable order.
 */
export function globFiles(
  glob: (pattern: string) => string[],
  globs: readonly string[],
  skipDirs: readonly string[] = [],
): string[] {
  const skip = new Set(skipDirs);
  const found = new Set<string>();
  for (const pattern of globs) {
    for (const rel of glob(pattern)) {
      if (!rel.split('/').some((segment) => skip.has(segment))) found.add(rel);
    }
  }
  return [...found].sort();
}

/** A YAML line with its trailing comment removed (a `#` at the start or after whitespace). */
export function stripYamlComment(line: string): string {
  return line.replace(/(^|\s)#.*$/u, '');
}

/** A YAML scalar with surrounding quotes removed. */
export function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/u, '$2');
}

/**
 * Expand base-name patterns into globs that match them at any depth, including
 * inside dot-directories (`.devcontainer/Dockerfile`), which `fs.globSync`'s
 * `**` does not enter on its own.
 */
export function anywhereGlobs(baseNames: readonly string[]): string[] {
  return baseNames.flatMap((name) => [`**/${name}`, `**/.*/**/${name}`]);
}

/**
 * A repo-relative file's text, or `null` when it cannot be read as a file.
 *
 * `ctx.glob` can return a DIRECTORY whose name matches a file pattern (a
 * snapshot folder named `button.test.tsx/` matches `**\/*.tsx`), and the
 * harness's `ctx.read` throws `EISDIR` on one. A glob-then-read rule treats
 * that entry as not a source file rather than letting one folder abort the run.
 */
export function readSourceText(read: (rel: string) => string | null, rel: string): string | null {
  try {
    return read(rel);
  } catch {
    // EISDIR (a directory matched the glob) or a file that vanished mid-run.
    return null;
  }
}
