/**
 * `@noctcore/lint-meta-rules/typescript`: checks that read JS and TS through the
 * TypeScript parser.
 *
 * A separate entry point because these rules load `typescript` (an optional
 * peer): a comment or a config value can only be found reliably with the
 * parser, and the main entry stays free of it. None is in `RULE_FACTORIES` or
 * `createAllRules()`.
 */
export {
  createNoInlineLintDisableRule,
  type NoInlineLintDisableOptions,
} from './typescript/no-inline-lint-disable';
export { createNoTsIgnoreRule, type NoTsIgnoreOptions } from './typescript/no-ts-ignore';
export {
  createTestFileMatchesRunnerIncludeRule,
  type DeclaredRunner,
  type TestFileMatchesRunnerIncludeOptions,
} from './typescript/test-file-matches-runner-include';
export type { DirectiveScanOptions } from './typescript/directives';
export type { RunnerName } from './typescript/runners';
