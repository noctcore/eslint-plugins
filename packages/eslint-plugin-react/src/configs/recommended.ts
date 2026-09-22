/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs/recommended.test.ts` fails if a `warn` comes back.
 */
export const recommended = {
  'noctcore-react/component-props-naming': 'error',
  'noctcore-react/context-value-must-be-memoized': 'error',
  'noctcore-react/max-hook-return-surface': 'error',
  'noctcore-react/max-hooks-per-file': 'error',
  'noctcore-react/max-props-per-component': 'error',
  // Fires only on an effect whose whole body is `setX(...)` of values read from
  // its own deps; anything with a branch, call or cleanup bails out unflagged.
  'noctcore-react/no-effect-derived-state': 'error',
  'noctcore-react/no-jsx-computation': 'error',
  'noctcore-react/no-jsx-in-hooks': 'error',
  'noctcore-react/no-prop-drilling': 'error',
  'noctcore-react/no-state-in-component-body': 'error',
  'noctcore-react/prefer-lazy-state-init': 'error',
  'noctcore-react/props-must-be-visual': 'error',
  // A state update after an await with nothing to cancel it is a real bug, and
  // any recognisable guard (AbortController, a cancel flag, a cleanup) silences it.
  'noctcore-react/require-effect-cancellation': 'error',
} as const;
