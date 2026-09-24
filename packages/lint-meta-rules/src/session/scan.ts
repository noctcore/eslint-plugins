import type { IMetaCtx } from '@noctcore/harness';

import { DEFAULT_SKIP_DIRS, escapeRegExp, globFiles, readSourceText } from '../rules/shared';

/**
 * The source scope every session rule shares: which files are read, and which
 * of them are left alone because they drive the seam directly (tests).
 */
export interface SessionSourceScopeOptions {
  /**
   * Globs of the application source that can open a session, relative to the
   * repo root. Empty (the default) makes the rule inert: it reads nothing and
   * reports nothing. Point it at shipped code only; a lint-meta rule module that
   * quotes the call in its own pattern is not a call site.
   */
  readonly sourceGlobs?: readonly string[];
  /** Paths with any of these segments are skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /**
   * Files ending in any of these are skipped: tests drive the seam directly,
   * including shapes production never produces. Default
   * `['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx']`.
   */
  readonly excludeSuffixes?: readonly string[];
}

export const DEFAULT_EXCLUDE_SUFFIXES: readonly string[] = [
  '.spec.ts',
  '.spec.tsx',
  '.test.ts',
  '.test.tsx',
];

export interface SourceFile {
  /** Repo-relative, forward-slashed path. */
  readonly file: string;
  readonly text: string;
}

export interface ScopedSources {
  /** Every path the globs matched, minus `skipDirs`, before `excludeSuffixes`. */
  readonly matched: ReadonlySet<string>;
  /** The readable, non-excluded files, in path order. */
  readonly sources: readonly SourceFile[];
}

/** The files a session rule reads, per its {@link SessionSourceScopeOptions}. */
export function scopedSources(ctx: IMetaCtx, options: SessionSourceScopeOptions): ScopedSources {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const excludeSuffixes = options.excludeSuffixes ?? DEFAULT_EXCLUDE_SUFFIXES;
  const matched = globFiles(ctx.glob, options.sourceGlobs ?? [], skipDirs).map(toPosix);
  const sources: SourceFile[] = [];
  for (const file of matched) {
    if (excludeSuffixes.some((suffix) => file.endsWith(suffix))) continue;
    const text = readSourceText(ctx.read, file);
    if (text !== null) sources.push({ file, text });
  }
  return { matched: new Set(matched), sources };
}

/** A path with Windows separators normalised and any leading `./` dropped. */
export function toPosix(file: string): string {
  return file.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/** The configured paths, normalised the same way as the globbed ones. */
export function pathSet(files: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((files ?? []).map(toPosix));
}

/**
 * Whether `source` calls `.<method>(`, with any whitespace before the paren.
 * The leading dot excludes the method's own definition (`async method(`).
 */
export function callsMethod(source: string, method: string): boolean {
  return new RegExp(`\\.${escapeRegExp(method)}\\s*\\(`, 'u').test(source);
}

/**
 * The argument text of each `.<method>(...)` call in `source`.
 *
 * Scanned by balancing parentheses rather than matched with a regex: an options
 * object spans lines and holds its own braces and parens, and a non-greedy
 * regex either stops early or runs on into the next call. A scanner that never
 * finds the closing paren returns what it has, which is the fail-closed
 * direction (more text to search, never less). `.<method>Something(` is not a
 * call of `method`: only whitespace may sit between the name and the paren.
 */
export function callArguments(source: string, method: string): string[] {
  const needle = `.${method}`;
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const hit = source.indexOf(needle, from);
    if (hit === -1) break;
    from = hit + needle.length;

    const open = source.indexOf('(', from);
    if (open === -1) break;
    if (source.slice(from, open).trim() !== '') continue;

    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(open + 1, end));
    from = end;
  }
  return calls;
}

/** Whether `text` names `identifier` as a whole word (`epoch`, not `epochless`). */
export function mentionsIdentifier(text: string, identifier: string): boolean {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'u').test(text);
}

/** `message`, with the consumer's own pointer appended when there is one. */
export function withHint(message: string, hint: string | undefined): string {
  return hint === undefined || hint === '' ? message : `${message} ${hint}`;
}
