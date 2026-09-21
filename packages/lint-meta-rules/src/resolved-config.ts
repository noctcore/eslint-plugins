/**
 * `@noctcore/lint-meta-rules/resolved-config`: checks over the RESOLVED ESLint
 * config.
 *
 * A separate entry point because, unlike the main catalog, these rules load
 * ESLint and resolve a config through `calculateConfigForFile`, which is async:
 * they implement the harness's `runAsync` (0.3.0) rather than `run`. Importing
 * the main entry never loads ESLint; importing this one needs the optional peer
 * `eslint`.
 */
export {
  createEslintConfigNoWarnRule,
  type EslintConfigNoWarnOptions,
} from './resolved-config/eslint-config-no-warn';
