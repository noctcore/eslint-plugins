import { recommended } from './recommended';

/**
 * Rule id → severity for the `strict` preset: everything in `recommended`, plus
 * the house rules below. A house rule holds in a codebase that follows the same
 * conventions and reports widely in one that does not, so it is one spread away
 * instead of on by default.
 *
 * Naming (`component-props-naming`), size caps (`max-*`) and the thin component shell
 * (`no-jsx-computation`, `no-state-in-component-body`) are this house's React conventions,
 * not defects every codebase has.
 *
 * Every rule is `error` or `off`, never `warn`, as in `recommended`.
 */
export const strict = {
  ...recommended,
  'noctcore-react/component-props-naming': 'error',
  'noctcore-react/max-hook-return-surface': 'error',
  'noctcore-react/max-hooks-per-file': 'error',
  'noctcore-react/max-props-per-component': 'error',
  'noctcore-react/no-jsx-computation': 'error',
  'noctcore-react/no-state-in-component-body': 'error',
} as const;
