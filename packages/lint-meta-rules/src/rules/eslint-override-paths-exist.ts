import type { IMetaRule, IViolation } from '@noctcore/harness';

import { dirName, isGlobPattern, joinRelative, literalPrefix, normalizeRelative } from './glob-match';
import { DEFAULT_SKIP_DIRS, globFiles, readSourceText } from './shared';

/**
 * Options for {@link createEslintOverridePathsExistRule}.
 *
 * Ported from a private monorepo whose rule matched every quoted path with an
 * extension anywhere in the config; it now reads only `files`, `ignores` and
 * `globalIgnores(...)` entries, and checks the literal directory of a glob too.
 */
export interface EslintOverridePathsExistOptions {
  /** Globs of the ESLint flat config files to read. Default `eslint.config.{js,mjs,cjs,ts,mts,cts}` at any depth. */
  readonly configGlobs?: readonly string[];
  /**
   * Also require the literal directory a `files` glob starts with (`apps/web` in
   * `apps/web/**\/*.tsx`) to exist. Default `true`.
   */
  readonly checkGlobPrefixes?: boolean;
  /**
   * Also check literal `ignores` entries that name one file (a path with a directory and an
   * extension, such as `src/routeTree.gen.ts`). Directory and glob ignores are never checked:
   * they usually name build output that a clean checkout does not have yet. Default `true`.
   */
  readonly checkIgnores?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'eslint-override-paths-exist';

export const DEFAULT_ESLINT_CONFIG_GLOBS: readonly string[] = [
  '**/eslint.config.{js,mjs,cjs,ts,mts,cts}',
];

/** A single file named with a directory and an extension, the only ignores shape checked. */
const ONE_FILE = /^[^*?{}[\]!]+\/[^/*?{}[\]!]+\.[a-z0-9]{1,5}$/iu;

interface Entry {
  readonly key: 'files' | 'ignores';
  readonly value: string;
  readonly offset: number;
}

/**
 * `source` with comments blanked (offsets kept), reading strings and template
 * literals so a `//` inside `'https://...'` is not taken for a comment.
 */
function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"' || char === "'" || char === '`') {
      i += 1;
      while (i < source.length && source[i] !== char) i += source[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (char === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      const block = source[i + 1] === '*';
      const close = block ? source.indexOf('*/', i + 2) : source.indexOf('\n', i);
      const stop = close === -1 ? source.length : close + (block ? 2 : 0);
      for (let j = i; j < stop; j += 1) if (out[j] !== '\n') out[j] = ' ';
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const STRING = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/gu;
const ENTRY_KEY = /\b(files|ignores)\s*:\s*|\bglobalIgnores\s*\(\s*/gu;

/** The end of the array (or the single value) that starts at `start`. */
function valueEnd(code: string, start: number): number {
  if (code[start] !== '[') {
    const stop = code.slice(start).search(/[,}\n)]/u);
    return stop === -1 ? code.length : start + stop;
  }
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '[') depth += 1;
    if (code[i] === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

/** Every string literal written directly in a `files:`, `ignores:` or `globalIgnores(...)` value. */
export function overrideEntries(source: string): Entry[] {
  const code = blankComments(source);
  const entries: Entry[] = [];
  for (const match of code.matchAll(ENTRY_KEY)) {
    const key = match[1] === 'files' ? 'files' : 'ignores';
    const start = match.index + match[0].length;
    const end = valueEnd(code, start);
    for (const literal of code.slice(start, end).matchAll(STRING)) {
      const value = literal[2] ?? '';
      // A template with a substitution is computed; there is no path to check.
      if (literal[1] === '`' && value.includes('${')) continue;
      entries.push({ key, value, offset: start + literal.index });
    }
  }
  return entries;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/** The path that must exist for this entry to mean anything, or null when it is not checked. */
function requiredPath(entry: Entry, checkGlobPrefixes: boolean, checkIgnores: boolean): string | null {
  // A negated entry only narrows what another entry matched; a missing one changes nothing.
  if (entry.value.startsWith('!') || entry.value.includes('://')) return null;
  const value = normalizeRelative(entry.value);
  if (value === '' || value.startsWith('/')) return null;
  if (entry.key === 'ignores') return checkIgnores && ONE_FILE.test(value) ? value : null;
  if (!isGlobPattern(value)) return value;
  if (!checkGlobPrefixes) return null;
  const prefix = literalPrefix(value);
  return prefix === '' || prefix.split('/').every((segment) => segment === '..') ? null : prefix;
}

/** Literal `files` / `ignores` paths, and the directory each `files` glob starts in, must exist. */
export function createEslintOverridePathsExistRule(
  options: EslintOverridePathsExistOptions = {},
): IMetaRule {
  const configGlobs = options.configGlobs ?? DEFAULT_ESLINT_CONFIG_GLOBS;
  const checkGlobPrefixes = options.checkGlobPrefixes ?? true;
  const checkIgnores = options.checkIgnores ?? true;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'config',
    ciCritical,
    description:
      'Paths written in an ESLint flat config `files` or `ignores` entry (and the directory a `files` glob starts in) must exist, so a moved folder cannot leave an override that applies to nothing.',
    run(ctx) {
      const violations: IViolation[] = [];
      for (const file of globFiles((p) => ctx.glob(p), configGlobs, DEFAULT_SKIP_DIRS)) {
        const source = readSourceText((rel) => ctx.read(rel), file);
        if (source === null) continue;
        const configDir = dirName(file);
        for (const entry of overrideEntries(source)) {
          const required = requiredPath(entry, checkGlobPrefixes, checkIgnores);
          if (required === null || ctx.exists(joinRelative(configDir, required))) continue;
          const line = lineAt(source, entry.offset);
          const what =
            required === normalizeRelative(entry.value)
              ? `\`${entry.value}\`, which does not exist`
              : `\`${entry.value}\`, whose directory \`${required}\` does not exist`;
          violations.push({
            file,
            rule: RULE_ID,
            line,
            message: `line ${String(line)}: \`${entry.key}\` names ${what} relative to this config. ESLint says nothing about an entry that matches nothing, so the override has quietly stopped applying. Point it at where the code moved, or remove it.`,
          });
        }
      }
      return violations;
    },
  };
}
