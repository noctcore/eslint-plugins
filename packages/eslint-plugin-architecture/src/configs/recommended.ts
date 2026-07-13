/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-architecture/component-folder-structure': 'error',
  'noctcore-architecture/index-must-reexport-default': 'error',
  'noctcore-architecture/no-cross-feature-imports': 'error',
} as const;
