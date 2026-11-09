/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin namespace.
 *
 * A rule that needs options to do anything (`meta.docs.requiresOptions`) is left
 * out, not listed at `error` or `off`: a preset entry that checks nothing
 * would read as coverage the project does not have. The rules left out here
 * are listed in `tests/configs/recommended.test.ts`, and the README's
 * "Opt-in rules" block shows how to enable them.
 *
 * Both monorepo rules need a `scopes` option (there is no universal default
 * scope), so this preset is empty today. It stays exported so a config that
 * spreads it keeps working, and picks up any future rule that holds with no
 * project knowledge.
 */
export const recommended = {} as const;
