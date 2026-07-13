/** Rule id → severity for the `recommended` preset. Keys carry the plugin namespace. */
export const recommended = {
  // Precise, syntactic — safe as errors.
  'noctcore-async-safety/require-fetch-timeout': 'error',
  // Inert until you set `include` globs, so it ships enabled but off by default.
  'noctcore-async-safety/no-shared-mutable-module-state': 'error',
  // Heuristic — advisory. Warns rather than blocking.
  'noctcore-async-safety/forward-abort-signal': 'warn',
  'noctcore-async-safety/prefer-parallel-awaits': 'warn',
  'noctcore-async-safety/no-concurrent-shared-mutation': 'warn',
} as const;
