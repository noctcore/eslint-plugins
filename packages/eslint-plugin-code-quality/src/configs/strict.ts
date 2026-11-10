import { recommended } from './recommended';

/**
 * Rule id → severity for the `strict` preset: everything in `recommended`, plus
 * the house rules below. A house rule holds in a codebase that follows the same
 * conventions and reports widely in one that does not, so it is one spread away
 * instead of on by default.
 *
 * `prefer-early-return` is a style preference with no fix, and `no-bare-date-now` asks for
 * a project clock seam (`nowMs()` / `now()`) that a stranger's repo does not have.
 *
 * Every rule is `error` or `off`, never `warn`, as in `recommended`.
 */
export const strict = {
  ...recommended,
  'noctcore-code-quality/no-bare-date-now': 'error',
  'noctcore-code-quality/prefer-early-return': 'error',
} as const;
