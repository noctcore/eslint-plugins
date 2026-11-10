---
'@noctcore/eslint-plugin-electron': minor
---

New package `@noctcore/eslint-plugin-electron` for Electron main-process security, starting at 0.1.0 with three rules:

- `webpreferences-locked` (in `recommended` at `error`): `nodeIntegration`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`, `webviewTag`, `allowRunningInsecureContent` or `experimentalFeatures` set to `true`, or `contextIsolation`, `sandbox` or `webSecurity` set to `false`.
- `ipc-handler-validates-sender` (opt-in): an inline `ipcMain.handle` / `on` / `once` / `handleOnce` handler must check its sender in its first statement; `guards` names the check.
- `no-shell-outside-allowlist` (opt-in, needs `allowIn`): Electron's `shell` only in the listed files, however it is reached (named import, `electron.shell`, destructuring, `require`).
