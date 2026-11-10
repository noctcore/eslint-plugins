/**
 * A small glob matcher for paths a rule already holds (an `include` entry, a
 * `files:` override, an allowlist), as opposed to `ctx.glob`, which walks the
 * tree. Dependency free so the main entry stays light.
 *
 * Supports `**` (any number of segments), `*` and `?` (within one segment),
 * `[...]` classes, `{a,b}` alternation (nestable) and the extglobs test runners
 * use in their defaults: `?(a|b)`, `*(a|b)`, `+(a|b)` and `@(a|b)`. A negated
 * extglob (`!(a)`) is not supported and matches literally.
 */

const compiled = new Map<string, RegExp>();

/** Characters that make a path entry a pattern rather than a literal path. */
export const GLOB_META = /[*?[\]{}!()]/u;

/** Whether `entry` is a glob pattern rather than a literal path. */
export function isGlobPattern(entry: string): boolean {
  return GLOB_META.test(entry);
}

function escapeChar(char: string): string {
  return /[.+^$|\\()[\]{}*?/]/u.test(char) ? `\\${char}` : char;
}

/** The index of the bracket that closes the group opened at `open`, or -1. */
function closingIndex(glob: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = open; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '\\') {
      i += 1;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a group body on top-level `separator` characters. */
function splitTopLevel(body: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{' || char === '(') depth += 1;
    if (char === '}' || char === ')') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const EXTGLOB_SUFFIX: Readonly<Record<string, string>> = { '?': '?', '*': '*', '+': '+', '@': '' };

function translate(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i] ?? '';
    const next = glob[i + 1];

    if ('?*+@'.includes(char) && next === '(') {
      const close = closingIndex(glob, i + 1, '(', ')');
      if (close !== -1) {
        const alternatives = splitTopLevel(glob.slice(i + 2, close), '|').map(translate).join('|');
        out += `(?:${alternatives})${EXTGLOB_SUFFIX[char] ?? ''}`;
        i = close + 1;
        continue;
      }
    }

    if (char === '*') {
      if (next === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        const atSegmentEnd = i + 2 === glob.length || glob[i + 2] === '/';
        if (atSegmentStart && atSegmentEnd) {
          // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
          if (glob[i + 2] === '/') {
            out += '(?:.*/)?';
            i += 3;
          } else {
            out += '.*';
            i += 2;
          }
          continue;
        }
      }
      out += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }

    if (char === '[') {
      const close = glob.indexOf(']', i + 2);
      if (close !== -1) {
        const body = glob.slice(i + 1, close).replace(/^!/u, '^').replace(/\\/gu, '\\\\');
        out += `[${body}]`;
        i = close + 1;
        continue;
      }
    }

    if (char === '{') {
      const close = closingIndex(glob, i, '{', '}');
      if (close !== -1) {
        const alternatives = splitTopLevel(glob.slice(i + 1, close), ',');
        if (alternatives.length > 1) {
          out += `(?:${alternatives.map(translate).join('|')})`;
          i = close + 1;
          continue;
        }
      }
    }

    if (char === '\\' && next !== undefined) {
      out += escapeChar(next);
      i += 2;
      continue;
    }

    out += escapeChar(char);
    i += 1;
  }
  return out;
}

/** `glob` as an anchored regular expression over `/`-separated paths. Cached. */
export function globToRegExp(glob: string): RegExp {
  let regex = compiled.get(glob);
  if (regex === undefined) {
    regex = new RegExp(`^${translate(glob)}$`, 'u');
    compiled.set(glob, regex);
  }
  return regex;
}

/** `path` without a leading `./`, so `./src` and `src` compare equal. */
export function normalizeRelative(path: string): string {
  let out = path;
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

/** Whether `path` matches `glob` (both `/`-separated, relative to the same directory). */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(normalizeRelative(glob)).test(normalizeRelative(path));
}

/** Whether `path` matches any of `globs`. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/**
 * The leading segments of `glob` before the first segment that holds a glob
 * character: the directory the pattern can only match under. `''` when the
 * very first segment is already a pattern (`**\/*.ts`).
 */
export function literalPrefix(glob: string): string {
  const segments = normalizeRelative(glob).split('/');
  const literal: string[] = [];
  for (const segment of segments) {
    if (isGlobPattern(segment)) break;
    literal.push(segment);
  }
  return literal.join('/');
}

/** Join a directory (`''` for the root) and a relative path, resolving `.` and `..` segments. */
export function joinRelative(dir: string, rel: string): string {
  const out: string[] = dir === '' || dir === '.' ? [] : dir.split('/');
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0 || out[out.length - 1] === '..') out.push('..');
      else out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

/** The directory of a repo-relative file (`''` for a file at the root). */
export function dirName(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}
