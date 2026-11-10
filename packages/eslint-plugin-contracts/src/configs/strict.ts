import { recommended } from './recommended';

/**
 * Rule id → severity for the `strict` preset: everything in `recommended`, plus
 * the house rules below. A house rule holds in a codebase that follows the same
 * conventions and reports widely in one that does not, so it is one spread away
 * instead of on by default.
 *
 * Both are naming conventions: `zod-schema-naming` wants PascalCase `FooSchema` where many
 * codebases write `fooSchema`, and `wire-message-naming` derives the discriminant from the const name.
 *
 * Every rule is `error` or `off`, never `warn`, as in `recommended`.
 */
export const strict = {
  ...recommended,
  'noctcore-contracts/wire-message-naming': 'error',
  'noctcore-contracts/zod-schema-naming': 'error',
} as const;
