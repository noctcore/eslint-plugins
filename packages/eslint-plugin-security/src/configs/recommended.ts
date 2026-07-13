/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * `require-path-containment` is a high-false-positive, opt-in heuristic and is
 * intentionally omitted. It is exported and documented, so a consumer can enable
 * it explicitly (as `warn` or `error`), but it is not on by default.
 */
export const recommended = {
  'noctcore-security/no-shell-interpolation': 'error',
} as const;
