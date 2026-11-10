/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * Empty on purpose, and both rules are listed in
 * `tests/configs/recommended.test.ts`. Each one bans a shape that the project's
 * own calendar module must use, so neither holds until `allowIn` names that
 * module, and both match methods by name, which a stranger's repo may use for
 * real instants (`getHours()` for a greeting, a one-day cookie `maxAge`). The
 * preset stays exported so a config that spreads it keeps working, and picks up
 * any future rule that holds with no project knowledge.
 */
export const recommended = {} as const;
