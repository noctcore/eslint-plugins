/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * House policy: every rule is `error` or `off`, never `warn`. A warning is a rule
 * nobody obeys. `tests/configs/recommended.test.ts` fails if a `warn` comes back.
 *
 * Left out on purpose:
 * - `enforce-context-consumption`: checks nothing until its `contexts` registry is set.
 * - `no-native-date-input`: a house convention (use the design system's date
 *   picker), not a defect every codebase has.
 *
 * Naming, size caps and the thin component shell are house conventions and sit
 * in `strict` (`./strict.ts`), not here.
 */
export const recommended = {
  'noctcore-react/context-value-must-be-memoized': 'error',
  // Fires only on an effect whose whole body is `setX(...)` of values read from
  // its own deps; anything with a branch, call or cleanup bails out unflagged.
  'noctcore-react/no-effect-derived-state': 'error',
  'noctcore-react/no-jsx-in-hooks': 'error',
  'noctcore-react/no-prop-drilling': 'error',
  // The storage access itself throws in private browsing, with cookies blocked,
  // or under quota; a `typeof window` check does not catch it, only a `try` does.
  'noctcore-react/no-unguarded-web-storage': 'error',
  // A password field without `autoComplete` defeats password managers. Precise on
  // any codebase: an explicit value of any kind, `"off"` included, silences it.
  'noctcore-react/password-input-requires-autocomplete': 'error',
  'noctcore-react/prefer-lazy-state-init': 'error',
  'noctcore-react/props-must-be-visual': 'error',
  // A state update after an await with nothing to cancel it is a real bug, and
  // any recognisable guard (AbortController, a cancel flag, a cleanup) silences it.
  'noctcore-react/require-effect-cancellation': 'error',
} as const;
