import type { IMetaCtx, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from '../rules/glob-match';
import { DEFAULT_SKIP_DIRS, globFiles, readSourceText } from '../rules/shared';
import { sourceComments } from './parse';

/** Options every comment-directive rule takes. */
export interface DirectiveScanOptions {
  /** Globs of the source files to read. Default every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` file. */
  readonly sourceGlobs?: readonly string[];
  /** Globs of files where the directive is allowed (a vendored file, a deliberate type test). Default `[]`. */
  readonly allowedFiles?: readonly string[];
  /**
   * Globs of generated files, which are skipped: codegen output carries blanket suppressions by
   * design. Default `**\/*.gen.{ts,tsx}`, `**\/generated/**` and `**\/@generated/**`.
   */
  readonly generatedFiles?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

export const DEFAULT_SOURCE_GLOBS: readonly string[] = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

export const DEFAULT_GENERATED_FILES: readonly string[] = [
  '**/*.gen.{ts,tsx}',
  '**/generated/**',
  '**/@generated/**',
];

/** A comment with its opener, closer and surrounding whitespace removed. */
export function commentBody(text: string): string {
  const inner = text.startsWith('//') ? text.slice(2) : text.slice(2, text.endsWith('*/') ? -2 : undefined);
  return inner.trim();
}

/** What one comment means to the tool that reads it: a message when it is a forbidden directive, else null. */
export type DirectiveCheck = (commentText: string) => string | null;

/**
 * Every comment in the selected source files that `check` reports. A cheap text
 * pre-filter (`mention`) skips the parse for files that never name the directive.
 */
export function scanDirectives(
  ctx: IMetaCtx,
  ruleId: string,
  options: DirectiveScanOptions,
  mention: RegExp,
  check: DirectiveCheck,
): IViolation[] {
  const allowed = options.allowedFiles ?? [];
  const generated = options.generatedFiles ?? DEFAULT_GENERATED_FILES;
  const violations: IViolation[] = [];
  for (const file of globFiles((p) => ctx.glob(p), options.sourceGlobs ?? DEFAULT_SOURCE_GLOBS, DEFAULT_SKIP_DIRS)) {
    if (matchesAnyGlob(file, generated) || matchesAnyGlob(file, allowed)) continue;
    const source = readSourceText((rel) => ctx.read(rel), file);
    if (source === null || !mention.test(source)) continue;
    for (const comment of sourceComments(file, source)) {
      const message = check(comment.text);
      if (message !== null) {
        violations.push({ file, rule: ruleId, line: comment.line, message: `line ${String(comment.line)}: ${message}` });
      }
    }
  }
  return violations;
}
