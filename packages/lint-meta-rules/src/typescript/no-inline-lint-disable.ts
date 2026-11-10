import type { IMetaRule } from '@noctcore/harness';

import { commentBody, type DirectiveScanOptions, scanDirectives } from './directives';

/**
 * Options for {@link createNoInlineLintDisableRule}.
 *
 * Ported from the `forbidden-text` meta rule several consumer repos carried, which
 * read a pre-collected source list and hardcoded the generated-file test; both are
 * now options.
 */
export interface NoInlineLintDisableOptions extends DirectiveScanOptions {
  /**
   * Allow a directive that carries a description after ` -- ` (`// eslint-disable-next-line
   * no-console -- CLI output`). Default `false`: every inline disable is reported.
   */
  readonly allowWithDescription?: boolean;
}

const RULE_ID = 'no-inline-lint-disable';

/** ESLint reads a directive from the start of the trimmed comment body, and nowhere else. */
const DIRECTIVE = /^eslint-disable(?:-next-line|-line)?(?=\s|$)/u;

/** No inline `eslint-disable` directive in hand-written source. */
export function createNoInlineLintDisableRule(options: NoInlineLintDisableOptions = {}): IMetaRule {
  const allowWithDescription = options.allowWithDescription ?? false;
  return {
    id: RULE_ID,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Hand-written source must not carry inline eslint-disable directives; a deliberate exception belongs in a scoped config override.',
    run(ctx) {
      return scanDirectives(ctx, RULE_ID, options, /eslint-disable/u, (text) => {
        const body = commentBody(text);
        const directive = DIRECTIVE.exec(body)?.[0];
        if (directive === undefined) return null;
        if (allowWithDescription && /\s--\s+\S/u.test(body)) return null;
        return `\`${directive}\` turns a rule off where nobody reviews it. Fix the violation, or add a scoped \`files\` override with its reason to the ESLint config.${
          allowWithDescription ? ' A directive needs a description after ` -- `.' : ''
        }`;
      });
    },
  };
}
