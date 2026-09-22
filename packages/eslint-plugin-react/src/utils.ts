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

/*
 * A tiny, dependency-free glob matcher for the `allowIn` file-scope option.
 *
 * Patterns are matched against the linted file's path as ESLint reports it,
 * normalised to forward slashes. Because a leading `**\/` may match zero leading
 * directories, `**\/tests/**` matches whether the path is absolute or
 * project-relative. Inlined rather than pulled from `micromatch` so the rule
 * carries no runtime dependency, the same choice code-quality made for its
 * `allowIn` rules.
 *
 * Supported syntax: `**` (any characters, including `/`), `*` (any characters
 * except `/`), `?` (one character except `/`), and `{a,b}` brace alternation.
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

const compiledGlobs = new Map<string, RegExp>();

function compileGlob(glob: string): RegExp {
  const cached = compiledGlobs.get(glob);
  if (cached !== undefined) {
    return cached;
  }
  const regex = globToRegExp(glob);
  compiledGlobs.set(glob, regex);
  return regex;
}

/**
 * True when `filename` matches at least one of the `globs`. An empty pattern
 * list matches nothing. Backslashes are normalised to `/` so Windows paths
 * match the same globs as POSIX ones.
 */
export function matchesAny(filename: string, globs: readonly string[]): boolean {
  if (globs.length === 0) {
    return false;
  }
  const normalized = filename.split('\\').join('/');
  return globs.some((glob) => compileGlob(glob).test(normalized));
}
