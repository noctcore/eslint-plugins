import { recommended } from './recommended';

/**
 * Rule id → severity for the `strict` preset: everything in `recommended`, plus
 * the house rules below. A house rule holds in a codebase that follows the same
 * conventions and reports widely in one that does not, so it is one spread away
 * instead of on by default.
 *
 * Every rule in this plugin encodes a layout choice (file names, folder shape, feature
 * boundaries, import depth), so all of them live here and `recommended` is empty.
 *
 * Every rule is `error` or `off`, never `warn`, as in `recommended`.
 */
export const strict = {
  ...recommended,
  'noctcore-architecture/barrel-purity': 'error',
  'noctcore-architecture/component-folder-structure': 'error',
  'noctcore-architecture/filename-matches-export': 'error',
  'noctcore-architecture/index-must-reexport-default': 'error',
  'noctcore-architecture/max-import-depth': 'error',
  'noctcore-architecture/no-cross-feature-imports': 'error',
} as const;
