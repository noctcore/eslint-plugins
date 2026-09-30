/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * The opinionated / niche rules — `interface-prefix-i` (a house-style naming
 * convention) and `no-template-trim-empty-ternary` (a very specific inline
 * shape) — are intentionally omitted. They are exported and documented, so a
 * consumer can enable them explicitly, but they are not on by default.
 *
 * The test-discipline rules below are omitted because each needs a
 * per-project fact before it is precise at `error`:
 * - `no-message-only-throw-assertion`: whether an error instance pins its class
 *   depends on the runner (Vitest compares it, Jest only its message), and a
 *   project's own class-pinning assertion helpers are configured by name.
 * - `no-sleep-in-unit-tests`: which test files are unit tests, not suites that
 *   drive real processes or databases, is a naming convention.
 */
export const recommended = {
  'noctcore-code-quality/prefer-early-return': 'error',
  'noctcore-code-quality/no-process-exit': 'error',
  'noctcore-code-quality/no-bare-date-now': 'error',
  'noctcore-code-quality/no-historical-comments': 'error',
  'noctcore-code-quality/no-narration-comments': 'error',
  'noctcore-code-quality/no-pr-reference-comments': 'error',
  'noctcore-code-quality/no-elided-code-comments': 'error',
  'noctcore-code-quality/no-focused-tests': 'error',
  'noctcore-code-quality/skipped-tests-need-tracking': 'error',
  'noctcore-code-quality/no-vacuous-expect': 'error',
  'noctcore-code-quality/no-conditional-expect': 'error',
  'noctcore-code-quality/no-swallowed-assertion': 'error',
  'noctcore-code-quality/fake-timers-must-be-restored': 'error',
  'noctcore-code-quality/no-real-network-in-unit-tests': 'error',
} as const;
