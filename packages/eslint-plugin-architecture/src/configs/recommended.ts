/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them.
 */
export const recommended = {
  'noctcore-architecture/barrel-purity': 'error',
  'noctcore-architecture/component-folder-structure': 'error',
  'noctcore-architecture/filename-matches-export': 'error',
  'noctcore-architecture/index-must-reexport-default': 'error',
  'noctcore-architecture/max-import-depth': 'error',
  'noctcore-architecture/no-cross-feature-imports': 'error',
  // Ships OFF: which files it governs and which category mixes they may keep
  // (a NestJS `.constants.ts` legitimately holds constants, types and enums) is
  // a per-codebase decision best made from measured counts. Enable it with
  //   'noctcore-architecture/single-semantic-module': ['error', { allow: [['constant', 'type', 'enum']] }]
  'noctcore-architecture/single-semantic-module': 'off',
} as const;
