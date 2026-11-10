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

/** `path` without trailing slashes. A loop, not `/\/+$/`, which backtracks quadratically on long slash runs. */
export function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
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

/** Default Dockerfile globs: `Dockerfile`, `Dockerfile.*` and `*.Dockerfile` at any depth, dot-directories included. */
export const DEFAULT_DOCKERFILE_GLOBS: readonly string[] = anywhereGlobs([
  'Dockerfile',
  'Dockerfile.*',
  '*.Dockerfile',
]);

/** Default workspace manifests: the root `package.json` and one level under `apps/`, `packages/` and `tools/`. */
export const DEFAULT_MANIFEST_GLOBS: readonly string[] = [
  'package.json',
  'apps/*/package.json',
  'packages/*/package.json',
  'tools/*/package.json',
];

/** A plain JSON object (not an array, not null), or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One manifest as read from the tree: its parsed object, or the reason it could not be parsed. */
export type ManifestRead =
  | { readonly file: string; readonly ok: true; readonly pkg: Record<string, unknown> }
  | { readonly file: string; readonly ok: false; readonly reason: string };

/** Every manifest the globs match (skipping `node_modules` and friends), parsed, in a stable order. */
export function readManifests(
  ctx: { glob(pattern: string): string[]; read(rel: string): string | null },
  globs: readonly string[],
): ManifestRead[] {
  const out: ManifestRead[] = [];
  for (const file of globFiles((p) => ctx.glob(p), globs, DEFAULT_SKIP_DIRS)) {
    const text = readSourceText((rel) => ctx.read(rel), file);
    if (text === null) continue;
    try {
      const pkg = asRecord(JSON.parse(text));
      out.push(pkg === null ? { file, ok: false, reason: 'is not a JSON object' } : { file, ok: true, pkg });
    } catch {
      out.push({ file, ok: false, reason: 'is not valid JSON' });
    }
  }
  return out;
}
