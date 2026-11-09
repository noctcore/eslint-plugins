/*
 * A small, dependency-free glob matcher for file-scope options (`allowIn` and
 * friends). Patterns are matched against the linted file's path as ESLint
 * reports it, normalised to forward slashes. Because a leading `**\/` may match
 * zero leading directories, `**\/tests/**` matches whether the path is absolute
 * or project-relative.
 *
 * Supported syntax:
 * - `**` any characters, including `/`; `**\/` also matches zero directories
 * - `*` any characters except `/`
 * - `?` one character except `/`
 * - `{a,b}` alternation; alternatives may hold wildcards and nested braces
 *
 * An unmatched `{` or `}` and a `,` outside braces are literal characters.
 * Dotfiles match: there is no implicit dot exclusion.
 */

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\/]/u;

/** Forward-slash a path so the same globs match on POSIX and Windows. */
export function toPosixPath(filename: string): string {
  return filename.split('\\').join('/');
}

/** Index of the `}` that closes the `{` at `open`, or -1 when it is never closed. */
function closingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i += 1) {
    if (glob[i] === '{') {
      depth += 1;
    } else if (glob[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Split the inside of a brace group on its top-level commas. */
function alternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function globSource(glob: string): string {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i] as string;
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 2;
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
      const end = closingBrace(glob, i);
      if (end === -1) {
        source += '\\{';
        i += 1;
      } else {
        source += `(?:${alternatives(glob.slice(i + 1, end)).map(globSource).join('|')})`;
        i = end + 1;
      }
    } else {
      source += REGEX_METACHARACTERS.test(char) ? `\\${char}` : char;
      i += 1;
    }
  }
  return source;
}

const compiledGlobs = new Map<string, RegExp>();

/** Compile a glob to an anchored RegExp. Compiled patterns are cached. */
export function globToRegExp(glob: string): RegExp {
  const cached = compiledGlobs.get(glob);
  if (cached !== undefined) {
    return cached;
  }
  const regex = new RegExp(`^${globSource(glob)}$`, 'u');
  compiledGlobs.set(glob, regex);
  return regex;
}

/**
 * True when `filename` matches at least one of the `globs`. An empty pattern
 * list matches nothing. Backslashes are normalised to `/` first.
 */
export function matchesAnyGlob(filename: string, globs: readonly string[]): boolean {
  if (globs.length === 0) {
    return false;
  }
  const normalized = toPosixPath(filename);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}
