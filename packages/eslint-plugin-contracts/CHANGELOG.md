# @noctcore/eslint-plugin-contracts

## 1.2.0

### Minor Changes

- [#245](https://github.com/noctcore/eslint-plugins/pull/245) [`b3411b3`](https://github.com/noctcore/eslint-plugins/commit/b3411b3f90a5d9224ca30a374e4fc06d4b1de18e) Thanks [@Shironex](https://github.com/Shironex)! - Add `route-params-validated`, an opt-in rule that reports a route call (`get`, `post`, `put`, `patch`, `delete` or `all` with a literal path) on a router the file proves, `new Hono()` or a `const` bound to one, when the path declares `:name` parameters and no argument in the chain is a param validator. A call to a name in `validators` (default `param`, so `v.param(Schema)` counts) or to a name in `validatorFactories` (default `zValidator` and `validator`) whose first argument is `'param'` counts as one; `routerNames` (default none) adds identifier names treated as routers. A `.use(...)` call carrying a param validator on the same router binding silences its routes. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.

- [#240](https://github.com/noctcore/eslint-plugins/pull/240) [`e02b49c`](https://github.com/noctcore/eslint-plugins/commit/e02b49cf13d44746345522e7357964d69e779d6d) Thanks [@Shironex](https://github.com/Shironex)! - Add `route-handler-order`, an opt-in rule that reports an argument of a route method call (`get`, `post`, `put`, `patch`, `delete`, `all` with a literal path) that comes after an argument of a later group, so an auth check cannot sit behind a body validator and a docs middleware cannot sit behind the handler. It needs `groups`, an ordered list of `{ name, callees }`, and does nothing without it; the last argument is the handler and is never classified. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.

- [#244](https://github.com/noctcore/eslint-plugins/pull/244) [`3b3eeff`](https://github.com/noctcore/eslint-plugins/commit/3b3eeffc55af1c3f5ed3c41228313284eefd14e3) Thanks [@Shironex](https://github.com/Shironex)! - Add `describe-auth-matches-middleware`, an opt-in rule that reads the docs call of a route method call (`describe({ auth: 'session' })`, with `get`, `post`, `put`, `patch`, `delete` or `all` and a literal path) and checks it against the chain: it reports a declared kind whose middleware is missing, middleware that is mapped only to another kind, and a declared kind that is not a key of `map`. It needs `map`, from each auth kind to the middleware names that satisfy it, and does nothing without it; `docsCallee` and `authProperty` change which call and property are read. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.

## 1.1.0

### Minor Changes

- [#208](https://github.com/noctcore/eslint-plugins/pull/208) [`73b66b3`](https://github.com/noctcore/eslint-plugins/commit/73b66b3686fd18d5ffd4bf92415066a9497cf560) Thanks [@Shironex](https://github.com/Shironex)! - `no-direct-process-env` gains a `sources` option. Its values are `process.env` and `import.meta.env`, and it defaults to `['process.env']`, so existing configs behave exactly as before. With `import.meta.env` listed, the rule reports dot access, `import.meta['env']`, destructuring and bare reads, and never reports Vite's build constants `MODE`, `DEV`, `PROD`, `SSR` and `BASE_URL`. The report message now names the source that was read, with identical text under the default. A project spreading `recommended` sees no new errors.

- [#210](https://github.com/noctcore/eslint-plugins/pull/210) [`df85134`](https://github.com/noctcore/eslint-plugins/commit/df85134252b8c01a536821bbef10d1d5fc632b7e) Thanks [@Shironex](https://github.com/Shironex)! - Add `zod-field-describe`, an opt-in rule that reports a property of a `z.object` (or an `.extend` shape) whose schema has no `.describe('...')` and no `.meta({ description })`, so generated JSON Schema, tool definitions and API docs have text for every field. It takes `zodIdentifiers` and `allowSchemaReferences` (default `true`, which leaves a field that is another schema, such as `user: UserSchema`, to that schema's own description). The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors; enable it under a `files` glob for your schema modules.

- [#207](https://github.com/noctcore/eslint-plugins/pull/207) [`69a2d25`](https://github.com/noctcore/eslint-plugins/commit/69a2d2586cee0296f7287ae44eb1098b68e56471) Thanks [@Shironex](https://github.com/Shironex)! - `schema-enum-field-consistency` gains a `compareEnumValues` option (default `false`). When on, it reports a field whose `z.enum` value lists differ between two schemas of one file. Only literal lists are compared: an inline array, or a same-file `const` array or `const` enum schema. A project spreading `recommended` or `strict` sees no new errors, because the option is off by default.

### Patch Changes

- [#233](https://github.com/noctcore/eslint-plugins/pull/233) [`227e0c8`](https://github.com/noctcore/eslint-plugins/commit/227e0c822f33121c3572cbb69a4f38f9487c69c3) Thanks [@Shironex](https://github.com/Shironex)! - Fix two gaps in `zod-field-describe`: a field built from a member chain on the zod namespace (`z.coerce.string().min(1)`, `z.iso.date()`) was skipped and now needs a description, and a description inside the first argument of `z.optional(...)` or `z.nullable(...)` is now found instead of reported as missing. The rule is in no preset, so a project spreading `recommended` sees no new errors; a project that enabled it may see new reports on undescribed `z.coerce` fields.

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

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

- [#159](https://github.com/noctcore/eslint-plugins/pull/159) [`f66255f`](https://github.com/noctcore/eslint-plugins/commit/f66255f2c2b3b6de295a9159f9ec59bc345d49e3) Thanks [@Shironex](https://github.com/Shironex)! - `no-direct-process-env`: the default `allowedFiles` now also covers `.mts` / `.cts` config files, tests written as `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts`, and repo tooling under `tools/` (next to `scripts/`). The message no longer reads as framework specific and points at `allowedFiles` for a script whose environment is its input. A project that passes its own `allowedFiles` is unaffected.

- [#103](https://github.com/noctcore/eslint-plugins/pull/103) [`14ba71c`](https://github.com/noctcore/eslint-plugins/commit/14ba71c5a23115e235edd441510ae7707e2aa9c5) Thanks [@Shironex](https://github.com/Shironex)! - Fix false positives and false negatives in six rules, and stop one autofix writing code that does not compile.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - `money-must-be-decimal` now checks a money-named key typed `z.number()` in a `z.object({...})` (`checkZod`, on by default; `zodIdentifiers` for a renamed import), and treats `number | null` / `number | undefined` like `number`. Interface members and function parameters are new opt-in checks (`checkTypeMembers`, `checkParameters`, both off), so the documented "type members stay out of scope" default holds.
  - `no-error-stringify` now reports any name bound by a `catch (x)` clause or a rejection handler (`.catch((x) => ...)`, the second callback of `.then`), whatever the name.
  - `zod-schema-naming` now sees schemas built from a local schema const (`Base.extend({...})`), from an identifier named like a schema (`BaseSchema.extend({...})`), and from a renamed zod import listed in the new `zodIdentifiers` option.
  
  **Reports less:**
  
  - `money-must-be-decimal` no longer reports counts: a name with a counter word (`totalPages`, `totalCount`, `priceIndex`, `total_items`; configurable with `counterWords`) and a bare `total` on a pagination-shaped class or type (`PageMetaDto`, `PaginatedResult`).
  - `no-error-stringify` drops `e` and `cause` from the default `errorIdentifierNames` (now `error`, `err`), so `sizes.map((e) => \`${e}px\`)` and `` `because ${cause}` `` are no longer reported; a catch-bound `e` still is. A project that set `errorIdentifierNames` keeps its list. The message now says what the coercion actually produces (`"Error: <message>"` or `"[object Object]"`), and each report offers a suggestion that rewrites to `x instanceof Error ? x.message : String(x)`.
  - `env-var-schema-parity` (opt-in) no longer reports keys the runtime defines (`MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`, `NODE_ENV`), and re-reads the schema when its mtime moves, so an editor session sees a newly declared key without a restart. It now also checks destructured keys (`const { FOO } = process.env`).
  
  **Autofix change:** `require-error-cause` autofixes only for the built-in errors and constructors listed in the new `autofixConstructors` option. Any other `*Error` / `*Exception` gets the same edit as a suggestion, because appending `{ cause }` to a constructor that does not take options was a type error (`new AppError('E_RUN', 'run failed')` became a three-argument call).
  
  **Opt-in rule fix:** `require-registered-keys` now matches a sink rooted at `this` (`this.redis.set(...)`), and a sink with two or more segments matches as a dotted suffix (`redis.set` covers `this.redis.set`, `localStorage.getItem` covers `window.localStorage.getItem`).

- [#179](https://github.com/noctcore/eslint-plugins/pull/179) [`76b921c`](https://github.com/noctcore/eslint-plugins/commit/76b921c3796e7bf970447a4c2fcc6453a1418b38) Thanks [@Shironex](https://github.com/Shironex)! - **Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-contracts/strict`): `recommended` plus the house rules. The two naming conventions leave `recommended` and are on in `strict`: `zod-schema-naming` (PascalCase `FooSchema`, where many codebases write `fooSchema`) and `wire-message-naming` (a message's `type` literal derived from its const name).
  
  Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.
  
  - `zod-schema-naming`: 229 / 8 / 126 / 72
  - `wire-message-naming`: 0 / 0 / 0 / 0
  
  To keep linting as before, spread `contracts.configs.strict` where you spread `contracts.configs.recommended`, or enable the two rules by name.

- [#159](https://github.com/noctcore/eslint-plugins/pull/159) [`fd98467`](https://github.com/noctcore/eslint-plugins/commit/fd98467ff4bb46d7cefc8d7619cc44a1d2b0edd3) Thanks [@Shironex](https://github.com/Shironex)! - `restrict-throw-to-taxonomy` is no longer in `recommended` and is marked as needing options. With the default `allow: ['Error']` it reported every framework exception (`throw new NotFoundException()`) and every built-in other than `Error`, so it only means something once `allow` names your error classes. Enable it by name with that list; the README's "Opt-in rules" block shows how.

- [#182](https://github.com/noctcore/eslint-plugins/pull/182) [`3326a8d`](https://github.com/noctcore/eslint-plugins/commit/3326a8da6abc3efb0a60ec9fe59e4cd5d04c245d) Thanks [@Shironex](https://github.com/Shironex)! - `no-error-stringify` no longer reports inside a logger call's arguments (`logger.error(`failed: ${err}`)`). That line belongs to observability `no-error-detail-loss`, which asks for the error object itself; this rule's advice (`err instanceof Error ? err.message : String(err)`) produced exactly the message-only log the other rule forbids, so the two gave opposite advice on one line.
  
  New options: `checkLoggerArguments` (default `false`; set `true` to report inside logger calls as before, for a project that does not run the observability plugin), and `loggers` / `methods`, which take the same values as in `no-error-detail-loss` (defaults `console`, `logger`, `log` and the usual log levels). Stringifying outside a logger call, including in a callback passed to one, is reported as before.
  
  A project that spreads `recommended` sees fewer reports, never new ones.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`65a5d38`](https://github.com/noctcore/eslint-plugins/commit/65a5d38d04029b10c464ec9c64cc4e13f52147f9) Thanks [@Shironex](https://github.com/Shironex)! - `recommended` now leaves out every rule that needs options to do anything, instead of listing it at `error` or `off` while it checks nothing. Removed entries: architecture `colocated-test-required`; async-safety `require-client-timeout` and `no-shared-mutable-module-state`; contracts `require-registered-keys`, `env-var-schema-parity` and `translation-key-exists`; monorepo `no-deep-package-imports` and `no-unexported-subpath-import` (its preset is now empty); observability `audit-pii-declared`.
  
  No lint result changes for a project that spreads `recommended`: without their options these rules reported nothing. A project that configures one of them by name keeps working unchanged. The README's "Opt-in rules" block shows how to enable each.

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

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#159](https://github.com/noctcore/eslint-plugins/pull/159) [`e7d112d`](https://github.com/noctcore/eslint-plugins/commit/e7d112dedf552391ef20a267c52f7a4b02614baa) Thanks [@Shironex](https://github.com/Shironex)! - `money-must-be-decimal`: `allowedFiles` entries are now globs (`**/legacy/**`). A plain path is still a path suffix, now matched at a directory boundary, so `totals.ts` no longer exempts `subtotals.ts`. The i18n catalog reader behind `translation-key-exists` now uses the shared mtime file cache from `@noctcore/eslint-utils`; a catalog that exists but cannot be read is still reported as unreadable rather than treated as absent.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.

- [#97](https://github.com/noctcore/eslint-plugins/pull/97) [`d5db997`](https://github.com/noctcore/eslint-plugins/commit/d5db99734ce3749efe6b7e1eebe1b342e45892d9) Thanks [@Shironex](https://github.com/Shironex)! - Docs only: every rule that reads another file (a schema, a catalog, a directory listing, a workspace manifest) now says so, notes that `eslint --cache` keeps the old result when that file changes, and links the new "Rules that read other files" page. No rule behaviour changes.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` config object now has a `name` (`noctcore-<plugin>/recommended`), so the ESLint config inspector and config error messages show which block it is instead of an anonymous one. Nothing else about the preset changes.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0

## 0.7.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

## 0.7.1

### Patch Changes

- [#44](https://github.com/noctcore/eslint-plugins/pull/44) [`da6ce97`](https://github.com/noctcore/eslint-plugins/commit/da6ce97dbfa4eb3a3bb39444929276661d8857b7) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README now follows the same layout in every
  package: requirements, install, a quick start with `files` and the TypeScript parser, one config
  block for every opt-in rule, the rules table and the severity policy. Every rule doc now has the same
  sections in the same order: why, what it flags, what it does not flag, options, when not to use it.

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
- Updated dependencies [[`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885), [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70)]:
  - @noctcore/eslint-utils@0.1.2

## 0.7.0

### Minor Changes

- [#14](https://github.com/noctcore/eslint-plugins/pull/14) [`b117f78`](https://github.com/noctcore/eslint-plugins/commit/b117f78616e798aaae7dffc730bef3c8cc56d8a1) Thanks [@Shironex](https://github.com/Shironex)! - `require-schema-parse-at-boundary` now follows same-function `const` bindings and knows more
  boundary reads. `const raw = await res.json(); return raw as User;` is reported, unless the binding
  is read before the cast by anything other than another cast (a guard, a validator call, an `in`
  check) or from a nested function; `let`, destructuring and parameters are not followed. New
  built-in sources: `localStorage.getItem` / `sessionStorage.getItem`, `URLSearchParams` `.get` /
  `.getAll` (including `<x>.searchParams` and a `searchParams` binding), `event.data` in a `message`
  listener, and an Anthropic `tool_use` block's `.input` when a `block.type === 'tool_use'` guard,
  `case`, `.find` or `.filter` proves the block type. OpenAI `JSON.parse(call.function.arguments)` was
  already covered by `JSON.parse`. A union cast target containing a shape claim (`as User | null`) now
  counts as a shape claim. The new `boundaries` option adds your own callees (`readBody`,
  `ipcRenderer.invoke`); it defaults to `[]`.

  The rule stays `off` in `recommended`, so a project that spreads `recommended` as-is sees no new
  errors. A project that has enabled the rule can see new errors from the binding-following, the new
  sources and the union targets.

## 0.6.1

### Patch Changes

- [`734f0f6`](https://github.com/noctcore/eslint-plugins/commit/734f0f610b8b17dd112f514965b3b2d6bbbdf452) Thanks [@Shironex](https://github.com/Shironex)! - Report the real package version in `meta.version`.

  Every plugin published a `meta.version` taken from a literal in its source while the
  version itself came from changesets, so the two drifted: all nine were behind, contracts
  by three minors (it said `0.3.0` while publishing `0.6.0`) and prisma by two (`0.1.0`
  against `0.3.1`). ESLint reads that field to identify a plugin, so anything keyed on
  plugin identity saw a build that had not existed for months.

  The constant is now written from package.json during `version-packages`, and a test
  compares the two so they cannot drift apart again.

- Updated dependencies [[`3166c84`](https://github.com/noctcore/eslint-plugins/commit/3166c8468dcfa29e6c964aa3d0035461b2420e6a)]:
  - @noctcore/eslint-utils@0.1.1

## 0.6.0

### Minor Changes

- [`bc5d82f`](https://github.com/noctcore/eslint-plugins/commit/bc5d82ff4871f2b865aaf0441516f73a58324fc6) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-plugin-react`: **behaviour change for consumers.** The `recommended` preset no
  longer ships any rule at `warn`. House policy is `error` or `off`: a warning is a rule nobody obeys,
  and a project that refuses `warn` in its resolved config could not use the preset at all.

  - `no-effect-derived-state`: `warn` to `error`. It fires only on an effect whose whole body is
    `setX(...)` of values read from its own deps; any branch, call, await or cleanup bails out.
  - `require-effect-cancellation`: `warn` to `error`. A state update after an await with nothing to
    cancel it is a real bug, and any recognisable guard (an `AbortController`, a `cancelled` flag, a
    cleanup `return`) silences it.

  Projects that spread `react.configs.recommended` as-is will now fail lint on findings that used to
  print as warnings. To keep the old behaviour, set either rule back yourself after the preset. A test
  in every plugin now fails if any preset emits `warn`.

  `@noctcore/eslint-plugin-contracts`: `money-must-be-decimal` gains a `minorUnitPatterns` option.
  Payment APIs such as Stripe carry money as an integer count of minor units (`amount: 1999` is
  19.99), which is exact in a `number`. List the regex fragments (case-insensitive, unanchored, so
  anchor them: `['^amount$', 'Cents$']`) that name such fields and the rule skips them. The default is
  empty, so nothing changes until you opt in.

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.5.0

### Minor Changes

- [`9b9d078`](https://github.com/noctcore/eslint-plugins/commit/9b9d078290f0ff4a8d8b0ca221bd867f186ca2c6) Thanks [@Shironex](https://github.com/Shironex)! - New: `createTranslationDeadKeysRule`, a whole-program dead translation-key check, on a new entry
  point `@noctcore/lint-meta-rules/i18n`.

  Dead-key detection cannot be sound as an ESLint rule: a per-file rule never sees every call site, and
  keys flow as data. This lint-meta factory walks every configured source file once, resolves call
  sites with the same visitor and catalog loader as `noctcore-contracts/translation-key-exists`, and
  also counts every string literal, template literal and `+` chain in the source as a possible key. It
  reports only keys that no call names and no string spells, and it reports no dead key at all when a
  source file cannot be analysed. Configure it with catalog locations and source globs; there are no
  built-in paths. Blind spots are listed in `docs/rules/translation-dead-keys.md`.

  The main entry point is unchanged and still never loads ESLint. The `i18n` entry needs the optional
  peers `eslint` (>= 9) and `@typescript-eslint/parser`.

  `@noctcore/eslint-plugin-contracts` now exports the i18n building blocks behind
  `translation-key-exists` (`createTranslationVisitor`, `catalogsForNamespace`, `catalogHasKey`,
  `catalogHasPrefix`, `translationSettingsOf`, `TRANSLATION_DEFAULTS` and their types), so the two
  checks share one implementation. Export-only: no rule behaviour changes.

## 0.4.0

### Minor Changes

- [`181d829`](https://github.com/noctcore/eslint-plugins/commit/181d829e29fddcb56ead64ce2093847e5e785dcc) Thanks [@Shironex](https://github.com/Shironex)! - Add `translation-key-exists`: a static i18next / react-i18next translation key (`t(...)`, `i18n.t(...)`, `getFixedT`, `<Trans i18nKey>`) must exist in the catalog of the namespace in scope. Namespace-aware (`useTranslation('ns')`, namespace arrays, `keyPrefix`, `ns:key`, `{ ns }`, `TFunction<'ns'>` parameters, same-file constants, a `namespaceIdentifiers` map, and literal types under typed linting), plural and context aware, and silent on dynamic keys and opaque options. Catalog locations are configured with `catalogs` (`{ns}` templates, `keyPath` subtrees); there is no built-in location. Ships `off` in `recommended` until configured.

## 0.3.0

### Minor Changes

- [`c351d42`](https://github.com/noctcore/eslint-plugins/commit/c351d4243378cfc147ccc825873b1adcacb1bbad) Thanks [@Shironex](https://github.com/Shironex)! - Add `fetch-must-check-ok`: a fetch response must be checked with `.ok` or a status comparison before `.json()` parses its body. Ported from tsforge `typescript-core/fetch-must-check-ok` (MIT) with its full test suite. Adds a `fetchFunctions` option (default `['fetch']`) for wrappers and dotted callees. On at `error` in `recommended`.

- [`d8bc7f4`](https://github.com/noctcore/eslint-plugins/commit/d8bc7f435398af6c286d034461f7721fa4052461) Thanks [@Shironex](https://github.com/Shironex)! - Add `schema-enum-field-consistency`: a field that is an enum in one zod object schema of a module must not be widened to `z.string()` in another, which leaks `string` to every consumer of the wire type. Upstreamed from Settly's local rule. Options: `zodIdentifiers` (default `['z']`), `ignoreFields` (default `[]`), `enumIdentifierPattern` (default unset). On at `error` in `recommended`.

## 0.2.0

### Minor Changes

- Add 5 rules: `require-error-cause` (fixable) and `restrict-throw-to-taxonomy` in recommended, plus inert-until-configured `require-registered-keys`, `env-var-schema-parity`, and `require-schema-parse-at-boundary`.
