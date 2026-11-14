/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * Left out on purpose, and listed in `tests/configs/recommended.test.ts`:
 * - `mutation-requires-error-handling`: an app that handles every mutation
 *   error in one global `MutationCache({ onError })` has nothing to fix, and
 *   the rule cannot see that cache from the component.
 * - `prefix-query-key-must-use-set-queries-data`: it reads one file, so a prefix
 *   that hooks in another file also use as a bare key looks unused here; with that
 *   blind spot it is a check to opt into, not a default error.
 * - `query-fn-must-not-swallow-error`: returning `null` from a `queryFn` for an optional
 *   resource is a legitimate contract, so the rule is an opt-in check for codebases that want
 *   every fallback marked.
 * - `query-key-must-be-constant`: keeping keys in a constant or key factory is a
 *   convention, not a defect, so a codebase whose inline keys work has nothing
 *   broken to fix.
 */
export const recommended = {
  'noctcore-query/effect-fired-mutation-must-bind-callbacks': 'error',
  'noctcore-query/trpc-invalidate-with-path-key': 'error',
} as const;
