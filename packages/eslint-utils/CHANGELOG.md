# @noctcore/eslint-utils

## 0.2.0

### Minor Changes

- [#180](https://github.com/noctcore/eslint-plugins/pull/180) [`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3) Thanks [@Shironex](https://github.com/Shironex)! - File exemptions are now called `allowIn` in every plugin, like the rules that already used that name (code-quality, react, dates, electron, prisma `tenant-scoped-tables-require-where` and `soft-deletable-tables-require-deleted-at`).
  
  | Rule | New option | Deprecated alias |
  | --- | --- | --- |
  | architecture `barrel-purity` | `allowIn` | `allow` |
  | architecture `colocated-test-required` | `allowIn` | `ignore` |
  | architecture `component-folder-structure` | `allowIn` (default `['**/ui/**']`) | `ignorePaths` |
  | architecture `filename-matches-export` | `allowIn` | `ignore` |
  | architecture `index-must-reexport-default` | `allowIn` | `ignorePaths` |
  | contracts `money-must-be-decimal` | `allowIn` | `allowedFiles` |
  | contracts `no-direct-process-env` | `allowIn` | `allowedFiles` |
  | prisma `no-raw-sql-outside-allowlist` | `allowIn` | `allowedFiles` |
  | prisma `no-unscoped-prisma-outside-allowlist` | `allowIn` | `allowedFiles` |
  
  Nothing breaks: the old names keep working through 1.x. When both the old name and `allowIn` are set, their globs are combined; when neither is set, the rule's default list applies as before. Scope options that turn a rule on (`include`, `files`) and prisma `restrict-model-writes` `restrictions[].allowedFiles` (who may write a model) keep their names.
  
  `@noctcore/eslint-utils` adds `resolveAllowIn(options, aliases, defaults)` and `allowInAliasDescription(alias)` for rules that read the option.

- [#165](https://github.com/noctcore/eslint-plugins/pull/165) [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7) Thanks [@Shironex](https://github.com/Shironex)! - Add `calleeName(callee)`: the called name of a callee (`mask` for `utils.mask(x)`, `this.audit.mask(x)` or `make().mask(x)`), or null for computed access. The observability and security plugins use it in place of their own copies.

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.

- [#181](https://github.com/noctcore/eslint-plugins/pull/181) [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5) Thanks [@Shironex](https://github.com/Shironex)! - The three fetch rules now take one shared wrapper list under one option name, `fetchCallees`, so a project declares its fetch wrapper once and passes the same list to all of them:
  
  ```js
  const fetchCallees = ['fetch', 'http.fetchWithCsrfRetry'];
  // async-safety/require-fetch-timeout, contracts/fetch-must-check-ok,
  // security/no-user-controlled-fetch-url: ['error', { fetchCallees }]
  ```
  
  An entry is a string (`'http.fetchWithRetry'`: the last segment is the method, the rest is the receiver as written) or an object (`{ object: 'axios', name: 'get', urlArgument: 0, urlProperty: 'url' }`). The URL position is read only by the security rule.
  
  - async-safety `require-fetch-timeout`: new `fetchCallees`; `callees` is a deprecated alias kept through 1.x (both lists are combined). The global `fetch` is still always checked. A wrapper rooted at `this` (`this.api.get`) can now be listed.
  - contracts `fetch-must-check-ok`: new `fetchCallees`; `fetchFunctions` is a deprecated alias kept through 1.x (both lists are combined; with neither set the default is still `['fetch']`).
  - security `no-user-controlled-fetch-url` and `no-user-controlled-redirect`: `fetchCallees` and `redirectCallees` now also accept the string form.
  
  Nothing breaks and the defaults are unchanged, so a project that spreads `recommended` sees no new reports. `@noctcore/eslint-utils` adds `matchFetchCallee`, `normalizeFetchCallees`, `toFetchCalleeSpec`, `fetchCalleeText`, `fetchCalleesSchema`, `fetchCalleeEntrySchema` and the `FetchCalleeSpec` / `FetchCalleeEntry` types.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

## 0.1.2

### Patch Changes

- [#40](https://github.com/noctcore/eslint-plugins/pull/40) [`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. Each package's npm page now links to its page on the
  docs site (`homepage` and a **Docs** link at the top of the README), and every plugin README states
  its requirements: ESLint 9 or newer, flat config only, and a `recommended` preset that sets no `files`
  and no parser, with a snippet for linting TypeScript. `@noctcore/eslint-utils` ships a README. Rule
  docs describe what a rule does today; third-party credits moved to a short section at the end.

- [#41](https://github.com/noctcore/eslint-plugins/pull/41) [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The rules table in each README is now generated from
  the rules' own metadata, with the same columns in every package: in `recommended`, needs options,
  fixable, suggestions, needs type information. Rule links point at the docs site. Every rule doc
  now opens with a one-line status header saying the same. Rules that do nothing until configured
  carry a new `meta.docs.requiresOptions: true`, and `@noctcore/eslint-utils` types that field
  (`NoctcoreRuleDocs`). A project that spreads `recommended` sees no new errors.

## 0.1.1

### Patch Changes

- [`3166c84`](https://github.com/noctcore/eslint-plugins/commit/3166c8468dcfa29e6c964aa3d0035461b2420e6a) Thanks [@Shironex](https://github.com/Shironex)! - `makeCreateRule` now points every rule's `meta.docs.url` at its rendered page on the docs site,
  `https://noctcore.github.io/eslint-plugins/rules/<plugin>/<rule>/`, instead of the raw Markdown
  file on GitHub. Plugins import `makeCreateRule` at runtime (it is not bundled into their `dist`),
  so consumers pick up the new links as soon as this version resolves in their install; the plugins
  themselves do not need a rebuild or a republish.
