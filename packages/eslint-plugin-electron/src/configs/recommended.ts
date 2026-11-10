/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * Left out on purpose, and listed in `tests/configs/recommended.test.ts`:
 * - `no-shell-outside-allowlist`: it needs `allowIn` (the one module that may
 *   use `shell`); without it every use is reported.
 * - `ipc-handler-validates-sender`: the Electron checklist asks for it, but an
 *   app that has not written a sender check yet would see every handler
 *   reported at once. Turn it on with your guard in `guards`.
 */
export const recommended = {
  'noctcore-electron/webpreferences-locked': 'error',
} as const;
