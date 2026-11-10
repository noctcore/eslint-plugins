import { recommended } from './recommended';

/**
 * The test-discipline rules of `recommended`, for the `tests` preset. Membership
 * is a list of ids and the severities come from `recommended`, so the two
 * presets cannot drift apart.
 *
 * The opt-in test rules (`no-message-only-throw-assertion`,
 * `no-sleep-in-unit-tests`, `no-real-clock-in-unit-tests`,
 * `typed-mock-over-double-cast`, `prefer-web-first-page-assertions`) stay out
 * for the reasons in `./recommended.ts`: each needs a project fact first.
 */
export const TEST_RULE_IDS = [
  'noctcore-code-quality/no-focused-tests',
  'noctcore-code-quality/skipped-tests-need-tracking',
  'noctcore-code-quality/no-vacuous-expect',
  'noctcore-code-quality/no-conditional-expect',
  'noctcore-code-quality/no-swallowed-assertion',
  'noctcore-code-quality/fake-timers-must-be-restored',
  'noctcore-code-quality/no-real-network-in-unit-tests',
] as const satisfies readonly (keyof typeof recommended)[];

type TestRuleId = (typeof TEST_RULE_IDS)[number];

/** Rule id to severity for the `tests` preset. */
export const tests = Object.fromEntries(TEST_RULE_IDS.map((id) => [id, recommended[id]])) as {
  readonly [Id in TestRuleId]: (typeof recommended)[Id];
};

/**
 * The files the `tests` preset applies to: `*.test.*` / `*.spec.*` files and
 * anything under a `__tests__` directory, in every JS and TS extension.
 */
export const TEST_FILES: readonly string[] = [
  '**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  '**/__tests__/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
];
