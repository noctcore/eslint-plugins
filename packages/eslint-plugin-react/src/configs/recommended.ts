/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-react/context-value-must-be-memoized': 'error',
  'noctcore-react/max-hook-return-surface': 'error',
  'noctcore-react/max-hooks-per-file': 'error',
  'noctcore-react/max-props-per-component': 'error',
  'noctcore-react/no-jsx-computation': 'error',
  'noctcore-react/no-prop-drilling': 'error',
  'noctcore-react/no-state-in-component-body': 'error',
  'noctcore-react/props-must-be-visual': 'error',
} as const;
