/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * Left out on purpose, and listed in `tests/configs/recommended.test.ts`:
 * - `mutation-requires-error-handling`: an app that handles every mutation
 *   error in one global `MutationCache({ onError })` has nothing to fix, and
 *   the rule cannot see that cache from the component.
 */
export const recommended = {
  'noctcore-query/effect-fired-mutation-must-bind-callbacks': 'error',
  'noctcore-query/trpc-invalidate-with-path-key': 'error',
} as const;
