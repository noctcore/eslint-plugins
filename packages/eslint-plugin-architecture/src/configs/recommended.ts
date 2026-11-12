/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them. Today those are
 * `colocated-test-required`, `file-naming-pattern` and
 * `no-restricted-imports-layered`.
 *
 * Every other rule here encodes a layout convention (file names, folder shape,
 * feature boundaries, import depth), so they all sit in `strict` (`./strict.ts`)
 * and this preset turns nothing on.
 */
export const recommended = {
  // Ships OFF: which files it governs and which category mixes they may keep
  // (a NestJS `.constants.ts` legitimately holds constants, types and enums) is
  // a per-codebase decision best made from measured counts. Enable it with
  //   'noctcore-architecture/single-semantic-module': ['error', { allow: [['constant', 'type', 'enum']] }]
  'noctcore-architecture/single-semantic-module': 'off',
} as const;
