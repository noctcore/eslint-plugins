/*
 * A tiny, dependency-free glob matcher for the `allowIn` file-scope options.
 *
 * The rules that take an `allowIn` list (no-process-exit, no-bare-date-now)
 * match each pattern against the linted file's path. To stay portable — no
 * monorepo-root resolution, no `micromatch`/`minimatch` dependency — the globs
 * are matched directly against `context.filename` (normalized to forward
 * slashes). Because a leading globstar-plus-slash may match zero leading
 * directories, a pattern such as a globstar followed by `clock.ts` matches
 * whether ESLint reports the file as an absolute path or a project-relative one.
 *
 * Supported syntax: double-star (any characters, including slash), single-star
 * (any characters except slash), `?` (one character except slash), and
 * `{a,b,c}` brace alternation.
 */

const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/gu;

function escapeLiteral(text: string): string {
  return text.replace(REGEX_METACHARACTERS, '\\$&');
}

function globToRegExp(glob: string): RegExp {
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
  return new RegExp(`^${source}$`, 'u');
}

const compiledCache = new Map<string, RegExp>();

function compile(glob: string): RegExp {
  const cached = compiledCache.get(glob);
  if (cached !== undefined) {
    return cached;
  }
  const regex = globToRegExp(glob);
  compiledCache.set(glob, regex);
  return regex;
}

/**
 * True when `filename` matches at least one of the `globs`. An empty pattern
 * list matches nothing. Backslashes are normalized to `/` so Windows paths
 * match the same globs as POSIX ones.
 */
export function matchesAny(filename: string, globs: readonly string[]): boolean {
  if (globs.length === 0) {
    return false;
  }
  const normalized = filename.split('\\').join('/');
  return globs.some((glob) => compile(glob).test(normalized));
}
