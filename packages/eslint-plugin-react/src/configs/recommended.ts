/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-react/component-props-naming': 'error',
  'noctcore-react/context-value-must-be-memoized': 'error',
  'noctcore-react/max-hook-return-surface': 'error',
  'noctcore-react/max-hooks-per-file': 'error',
  'noctcore-react/max-props-per-component': 'error',
  // Conservative, heuristic rules ship as warnings — a finding is a strong hint,
  // not a hard failure, and neither is autofixable.
  'noctcore-react/no-effect-derived-state': 'warn',
  'noctcore-react/no-jsx-computation': 'error',
  'noctcore-react/no-jsx-in-hooks': 'error',
  'noctcore-react/no-prop-drilling': 'error',
  'noctcore-react/no-state-in-component-body': 'error',
  'noctcore-react/prefer-lazy-state-init': 'error',
  'noctcore-react/props-must-be-visual': 'error',
  'noctcore-react/require-effect-cancellation': 'warn',
} as const;
