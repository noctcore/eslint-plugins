import { ESLintUtils } from '@typescript-eslint/utils';

const REPO = 'https://github.com/noctcore/eslint-plugins';

/**
 * Build a typed `RuleCreator` for a `@noctcore` plugin package.
 *
 * `domain` is the plugin's short name (e.g. `react`, `architecture`). It is
 * cosmetic — it only points each rule's docs URL at
 * `packages/eslint-plugin-<domain>/docs/rules/<rule>.md`.
 *
 * ```ts
 * // packages/eslint-plugin-react/src/createRule.ts
 * export const createRule = makeCreateRule('react');
 * ```
 */
export const makeCreateRule = (domain: string) =>
  ESLintUtils.RuleCreator(
    (ruleName) =>
      `${REPO}/blob/main/packages/eslint-plugin-${domain}/docs/rules/${ruleName}.md`,
  );
