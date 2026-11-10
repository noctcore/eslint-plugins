# @noctcore/eslint-plugin-dates

## 0.1.0

### Minor Changes

- [#174](https://github.com/noctcore/eslint-plugins/pull/174) [`9a4cb94`](https://github.com/noctcore/eslint-plugins/commit/9a4cb9474be98e497bf9a2add6531e906a1e03ba) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-dates` for calendar days stored as `Date`s, starting at 0.1.0 with two opt-in rules (the `recommended` preset is empty: both need `allowIn` to name your calendar module):
  
  - `no-local-calendar-time`: local `Date` accessors and setters (`getDate()`, `setHours()`), `new Date('YYYY-MM-DD')` and `Date.parse('YYYY-MM-DD')`, and `toISOString().slice(0, 10)` (or `.split('T')[0]`); `getTime()` compared with `Date.now()` through `checks: ['instantVsNow']`.
  - `calendar-math-via-shared`: `getUTC*` / `setUTC*`, `Date.UTC()`, `setMonth`, and a day in milliseconds (`86400000`, `24 * 60 * 60 * 1000` in any order) outside the calendar module.

### Patch Changes

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0
