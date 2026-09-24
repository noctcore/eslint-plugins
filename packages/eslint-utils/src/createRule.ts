import { ESLintUtils } from '@typescript-eslint/utils';

/** The docs site: project Pages for github.com/noctcore/eslint-plugins. */
const DOCS = 'https://noctcore.github.io/eslint-plugins';

/** The `meta.docs` fields a `@noctcore` rule may set beyond ESLint's own. */
export interface NoctcoreRuleDocs {
  /**
   * The rule does nothing useful until the consumer passes options: it reports
   * nothing, or everything, without a per-project fact such as a scope or a
   * list of models. The generated README table and rule-doc header mark it ⚙️.
   */
  readonly requiresOptions?: boolean;
}

/**
 * Build a typed `RuleCreator` for a `@noctcore` plugin package.
 *
 * `domain` is the plugin's short name (e.g. `react`, `architecture`), the part
 * of the package name after `eslint-plugin-`. It only shapes each rule's docs
 * URL, which points at the rule's page on the docs site:
 * `https://noctcore.github.io/eslint-plugins/rules/<domain>/<rule>/`. That page
 * is generated from `packages/eslint-plugin-<domain>/docs/rules/<rule>.md`.
 *
 * ```ts
 * // packages/eslint-plugin-react/src/createRule.ts
 * export const createRule = makeCreateRule('react');
 * ```
 */
export const makeCreateRule = (domain: string) =>
  ESLintUtils.RuleCreator<NoctcoreRuleDocs>((ruleName) => `${DOCS}/rules/${domain}/${ruleName}/`);
