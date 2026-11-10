import type { IMetaRule } from '@noctcore/harness';

import { commentBody, type DirectiveScanOptions, scanDirectives } from './directives';

/**
 * Options for {@link createNoTsIgnoreRule}.
 *
 * Ported from the `forbidden-text` meta rule several consumer repos carried, which
 * read a pre-collected source list and banned both directives everywhere; the
 * file lists and `@ts-expect-error` are now options.
 */
export interface NoTsIgnoreOptions extends DirectiveScanOptions {
  /**
   * Allow `@ts-expect-error`, which fails the build once the error it covers is gone, and report
   * only `@ts-ignore`. Default `false`: both are reported. To allow it only in type tests, leave
   * this off and list those files in `allowedFiles`.
   */
  readonly allowExpectError?: boolean;
}

const RULE_ID = 'no-ts-ignore';

/** tsc matches the directive as a prefix: `@ts-ignoreX` suppresses too, `@ts-ignorance` does not. */
const DIRECTIVE = /^@ts-(ignore|expect-error)/u;

/**
 * Where tsc reads a suppression in one comment: past any run of slashes or stars
 * that opens it (`/// @ts-ignore`, `/** @ts-ignore *\/`), and in a block comment
 * on its last line as well.
 */
function directiveTexts(text: string): string[] {
  const strip = (value: string): string => value.replace(/^[/*\s]*/u, '');
  const body = commentBody(text);
  if (!text.startsWith('/*')) return [strip(body)];
  const lines = body.split('\n');
  return [strip(body), strip(lines[lines.length - 1] ?? '')];
}

/** No `@ts-ignore` (and, unless allowed, no `@ts-expect-error`) in hand-written source. */
export function createNoTsIgnoreRule(options: NoTsIgnoreOptions = {}): IMetaRule {
  const allowExpectError = options.allowExpectError ?? false;
  return {
    id: RULE_ID,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Hand-written source must not suppress TypeScript errors with @ts-ignore (or @ts-expect-error unless allowed).',
    run(ctx) {
      return scanDirectives(ctx, RULE_ID, options, /@ts-(?:ignore|expect-error)/u, (text) => {
        for (const candidate of directiveTexts(text)) {
          const kind = DIRECTIVE.exec(candidate)?.[1];
          if (kind === undefined || (kind === 'expect-error' && allowExpectError)) continue;
          return kind === 'ignore'
            ? '`@ts-ignore` hides every error on the next line, including ones that appear later. Narrow the type or fix the underlying error.'
            : '`@ts-expect-error` suppresses a type error instead of fixing it. Narrow the type or fix the underlying error, or list a deliberate type test in `allowedFiles`.';
        }
        return null;
      });
    },
  };
}
