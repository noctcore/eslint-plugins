# @noctcore/eslint-plugin-architecture

## 1.1.0

### Minor Changes

- [#214](https://github.com/noctcore/eslint-plugins/pull/214) [`23e0393`](https://github.com/noctcore/eslint-plugins/commit/23e0393a320a02f9fbedeffd17840a9dffc986e5) Thanks [@Shironex](https://github.com/Shironex)! - Add the opt-in `file-naming-pattern` rule. In folders matched by `folders`, a file's basename must match `pattern`, a regular expression in which every `{folder}` stands for the file's immediate parent folder name (escaped), so `account/account.routes.ts` passes `^{folder}(\.[a-z-]+)?\.ts$` and `account/routes.ts` is reported with the expected pattern in the message. Files whose parent folder does not match, and files matched by `allowIn`, are never reported, and an invalid `pattern` is reported as a configuration problem instead of throwing. The rule does nothing until `folders` and `pattern` are set and is in neither preset, so a project spreading `recommended` or `strict` sees no new errors.

- [#206](https://github.com/noctcore/eslint-plugins/pull/206) [`b719374`](https://github.com/noctcore/eslint-plugins/commit/b7193741bce4d6ccc4b097da8824ad141411b6f8) Thanks [@Shironex](https://github.com/Shironex)! - `single-semantic-module` gains a `schemaFactories` option, for example `['errorOf']`. A call rooted at a listed name, such as `export const NotFound = errorOf('not-found')`, counts as `schema` instead of `constant`, so a schemas-only module built with a local helper is no longer reported as mixing kinds. The default is an empty list, so existing configs behave exactly as before. The rule ships `off` in `recommended`, so a project spreading `recommended` sees no new errors.

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

- [#171](https://github.com/noctcore/eslint-plugins/pull/171) [`f7cb130`](https://github.com/noctcore/eslint-plugins/commit/f7cb130296d57e9a73e2e2da5ebaa37d7cf43bca) Thanks [@Shironex](https://github.com/Shironex)! - Add `no-restricted-imports-layered`: import bans declared once as named sets and assigned to file layers. Every matching layer adds its sets, so bans merge per file instead of the last config block winning, and static imports, re-exports and dynamic `import()` are all covered. Opt-in, it needs options.
  
  `component-folder-structure` gains a `requireOwnFolder` option that reports a component file sitting loose in a feature folder instead of in its own `<Name>/<Name>.tsx` folder. Its reports now point at the first line of the file instead of the whole file.

- [#179](https://github.com/noctcore/eslint-plugins/pull/179) [`76b921c`](https://github.com/noctcore/eslint-plugins/commit/76b921c3796e7bf970447a4c2fcc6453a1418b38) Thanks [@Shironex](https://github.com/Shironex)! - **Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-architecture/strict`): `recommended` plus the house rules. Every architecture rule encodes a layout convention, so all six rules that `recommended` turned on move to `strict`, and `recommended` now turns nothing on (`single-semantic-module` stays listed at `off`).
  
  Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.
  
  - `filename-matches-export`: 527 / 605 / 499 / 428
  - `no-cross-feature-imports`: 252 / 119 / 156 / 29
  - `max-import-depth`: 113 / 1 / 28 / 13
  - `barrel-purity`: 53 / 36 / 0 / 2
  - `index-must-reexport-default`: 0 / 0 / 0 / 197
  - `component-folder-structure`: 0 / 0 / 0 / 0 (pure folder shape)
  
  To keep linting as before, spread `architecture.configs.strict` where you spread `architecture.configs.recommended`, or enable the rules one by one. A config that sets these rules by name is unaffected.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`65a5d38`](https://github.com/noctcore/eslint-plugins/commit/65a5d38d04029b10c464ec9c64cc4e13f52147f9) Thanks [@Shironex](https://github.com/Shironex)! - `recommended` now leaves out every rule that needs options to do anything, instead of listing it at `error` or `off` while it checks nothing. Removed entries: architecture `colocated-test-required`; async-safety `require-client-timeout` and `no-shared-mutable-module-state`; contracts `require-registered-keys`, `env-var-schema-parity` and `translation-key-exists`; monorepo `no-deep-package-imports` and `no-unexported-subpath-import` (its preset is now empty); observability `audit-pii-declared`.
  
  No lint result changes for a project that spreads `recommended`: without their options these rules reported nothing. A project that configures one of them by name keeps working unchanged. The README's "Opt-in rules" block shows how to enable each.

### Patch Changes

- [#163](https://github.com/noctcore/eslint-plugins/pull/163) [`afe195c`](https://github.com/noctcore/eslint-plugins/commit/afe195c215244a5f0b388ec77b166ac78353946e) Thanks [@Shironex](https://github.com/Shironex)! - `barrel-purity` only treats an `index.*` file as a barrel once it re-exports from another module (`export … from` or `export * from`). A server or package entry point named `index.ts` (`const app = createServer(); app.listen(3000)`, or a plugin entry that builds its object and exports an imported binding) no longer reports.

- [#93](https://github.com/noctcore/eslint-plugins/pull/93) [`517d22d`](https://github.com/noctcore/eslint-plugins/commit/517d22da15bd0169e23701e01ae65595beb6aa71) Thanks [@Shironex](https://github.com/Shironex)! - `single-semantic-module` keeps the original `SyntaxError` as the `cause` when it rejects an invalid `hookDetection.namePattern`, so the stack of the bad pattern is no longer lost. Found by linting this repository with its own rules.

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

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

## 0.3.4

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`fc9a372`](https://github.com/noctcore/eslint-plugins/commit/fc9a37226fb85f285b5211545708e833a9d962ae) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The `meta.docs.description` of `require-path-containment`, `server-action-through-client` (security) and `colocated-test-required` (architecture) no longer ends with an "opt-in" note: the rules table and rule page now show that with 🔘. The rules are still left out of `recommended`, so a project that spreads the preset as-is sees no change.

## 0.3.3

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

## 0.3.2

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

## 0.3.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.3.0

### Minor Changes

- [`97b2648`](https://github.com/noctcore/eslint-plugins/commit/97b264831de668a78128dc05034c288e955d99b8) Thanks [@Shironex](https://github.com/Shironex)! - Add `single-semantic-module`, ported from `@boring-stack-pkg/eslint-plugin-module-boundaries` 0.2.0 (MIT) so it runs on ESLint 10. A module's exported declarations are classified by AST shape into `type`, `constant`, `function`, `class`, `react-component`, `hook`, `schema` or `enum`, and a mix is reported unless an `allow` group covers it. `ignorePrivateDeclarations` defaults to `true`, so a private render helper or filter constant is not a second concern, and a declaration exported later by name (`export { x }`, `export default X`) counts as exported. Ships `off` in `recommended`.

## 0.2.0

### Minor Changes

- Add 4 rules: `barrel-purity`, `filename-matches-export` (suggestion fix), `colocated-test-required` (opt-in), and `max-import-depth` (conditional fix).
