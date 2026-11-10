# @noctcore/eslint-plugin-electron

## 0.1.0

### Minor Changes

- [#170](https://github.com/noctcore/eslint-plugins/pull/170) [`4aff5bc`](https://github.com/noctcore/eslint-plugins/commit/4aff5bc15f1ed28895dae64aadf881f65fb4992b) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-electron` for Electron main-process security, starting at 0.1.0 with three rules:
  
  - `webpreferences-locked` (in `recommended` at `error`): `nodeIntegration`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`, `webviewTag`, `allowRunningInsecureContent` or `experimentalFeatures` set to `true`, or `contextIsolation`, `sandbox` or `webSecurity` set to `false`.
  - `ipc-handler-validates-sender` (opt-in): an inline `ipcMain.handle` / `on` / `once` / `handleOnce` handler must check its sender in its first statement; `guards` names the check.
  - `no-shell-outside-allowlist` (opt-in, needs `allowIn`): Electron's `shell` only in the listed files, however it is reached (named import, `electron.shell`, destructuring, `require`).

### Patch Changes

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0
