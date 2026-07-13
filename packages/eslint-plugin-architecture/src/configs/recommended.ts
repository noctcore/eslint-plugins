/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  'noctcore-architecture/barrel-purity': 'error',
  // Ships OFF: this rule does nothing until you name the source globs that must
  // be tested (there is no universal "everything needs a test" default). Enable
  // it with your own `include`, e.g.
  //   'noctcore-architecture/colocated-test-required': ['error', { include: ['**/use*.ts', '**/*.service.ts'] }]
  'noctcore-architecture/colocated-test-required': 'off',
  'noctcore-architecture/component-folder-structure': 'error',
  'noctcore-architecture/filename-matches-export': 'error',
  'noctcore-architecture/index-must-reexport-default': 'error',
  'noctcore-architecture/max-import-depth': 'error',
  'noctcore-architecture/no-cross-feature-imports': 'error',
} as const;
