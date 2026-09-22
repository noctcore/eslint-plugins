/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * `require-path-containment` is a high-false-positive, opt-in heuristic and is
 * intentionally omitted. It is exported and documented, so a consumer can enable
 * it explicitly (as `warn` or `error`), but it is not on by default.
 *
 * `server-action-through-client` is omitted for a different reason: it needs
 * `actionClients`, the names of the project's action-client builders, and there
 * is no universal default. With an empty list it accepts no client and reports
 * every exported action, so a shared preset cannot turn it on for a stranger's
 * repo. Enable it with your own clients, e.g.
 *   'noctcore-security/server-action-through-client': ['error', { actionClients: ['actionClient', 'authActionClient'] }]
 */
export const recommended = {
  'noctcore-security/no-shell-interpolation': 'error',
  'noctcore-security/no-user-controlled-fetch-url': 'error',
  'noctcore-security/no-user-controlled-redirect': 'error',
} as const;
