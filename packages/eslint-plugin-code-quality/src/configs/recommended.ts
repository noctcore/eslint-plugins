/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * The opinionated / niche rules — `interface-prefix-i` (a house-style naming
 * convention) and `no-template-trim-empty-ternary` (a very specific inline
 * shape) — are intentionally omitted. They are exported and documented, so a
 * consumer can enable them explicitly, but they are not on by default.
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
