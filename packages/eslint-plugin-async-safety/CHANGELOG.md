# @noctcore/eslint-plugin-async-safety

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#162](https://github.com/noctcore/eslint-plugins/pull/162) [`2aea2d9`](https://github.com/noctcore/eslint-plugins/commit/2aea2d93f57b561bf48e20b32d14dd95acaaee19) Thanks [@Shironex](https://github.com/Shironex)! - `no-shared-mutable-module-state` (opt-in, needs `include`) now checks methods of exported classes, which is a new report, so this is a minor bump.
  
  - Every method of an exported class is an entry point, async or not: in a DI framework (a NestJS `@Injectable()`) one instance serves every request. `let cache = {}; export class S { set(k, v) { cache[k] = v; } }` is reported. The constructor is skipped (it runs at wiring time), and `this.x` instance state is not a module binding and is not checked. Class expressions, arrow-function properties and private methods count.
  - A function or class exported by a later `export { name }` or `export default name` is checked like an inline export.
  - Internal: the rules walk the parser's visitor keys through `@noctcore/eslint-utils` instead of their own `Object.keys` walker, and `no-leaky-race-timeout` uses the shared `enclosingFunction`. No report changes from that.

- [#78](https://github.com/noctcore/eslint-plugins/pull/78) [`8ba24a3`](https://github.com/noctcore/eslint-plugins/commit/8ba24a36bb451c2db7bdfcea6312729edfe0be4b) Thanks [@Shironex](https://github.com/Shironex)! - Fix false positives and false negatives in five rules.
  
  **A project that spreads `recommended` sees new errors from two rules it already runs**, which is why this is a minor bump:
  
  - `require-fetch-timeout` now reports `fetch(url)` when `url` is a variable. The first argument of `fetch` is the resource, never the options, so the old "it may be an options bag" exemption hid almost every real call. A `Request` built in view (`fetch(new Request(url, { signal }))`, or a `const` initialised that way) is still exempt. `timeout` no longer counts as a bound for the global `fetch`, because `fetch` has no such option: `fetch('/api', { timeout: 5 })` is reported. It still counts for wrappers named in `callees`, and a wrapper's lone non-string argument (`axios(config)`) is still skipped.
  - `no-leaky-race-timeout` now follows a timeout promise held in a `const`: `const timeout = new Promise((_, r) => setTimeout(r, ms)); Promise.race([work, timeout])` is reported like the inline form.
  
  **Reports less:**
  
  - `no-concurrent-shared-mutation` reports only when an `await` sits between the read and the write: `total += await size(i)` and `total = await add(total, i)`. `await save(i); done++;` and `const n = await size(i); total += n;` read and write in one synchronous step, cannot lose an update, and are no longer reported. `x++` is never reported.
  - `forward-abort-signal` no longer takes a parameter named `signal` as an `AbortSignal` when its type annotation says otherwise (`process.on('SIGTERM', async (signal: NodeJS.Signals) => ...)`). An untyped `signal` and any annotation that mentions `AbortSignal` are checked as before. Hooking the abort event by hand (`signal.addEventListener('abort', ...)`, `signal.onabort = ...`) now counts as forwarding.
  
  **Suggestion change:** `prefer-parallel-awaits` (opt-in) still reports a run that carries a type annotation or a comment, but no longer offers the one-line rewrite that would drop them.

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

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

- [#178](https://github.com/noctcore/eslint-plugins/pull/178) [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70) Thanks [@Shironex](https://github.com/Shironex)! - Repo-relative file globs now match. ESLint passes rules the absolute filename, and every file-scope option (`allowIn`, `allowedFiles`, `ignorePaths`, `ignore`, `include`, `allow` on barrels, `files`) anchored its globs on that absolute path, so a glob written like a flat-config `files` entry, such as `apps/server/**`, silently never matched. Only `**/`-prefixed globs worked.
  
  `@noctcore/eslint-utils` adds `fileMatchesAnyGlob(filename, globs, cwd)`, which tries a glob against the absolute path, the path relative to `context.cwd` and the path relative to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), plus `findRepoRoot`, `fileScopeCandidates`, `relativeInside` and `ROOT_MARKERS`. Every rule that takes file globs now uses it; prisma already matched the root-relative path and now also matches the cwd-relative one.
  
  What a consumer sees: `**/`-prefixed globs behave exactly as before. A relative glob that never matched now does, so an allowlist exempts the files it names (fewer reports), and an opt-in scope such as async-safety `no-shared-mutable-module-state` `include`, architecture `colocated-test-required` `include`, react `enforce-context-consumption` `files` or the prisma soft-delete `files` now arms the rule on the files it names (possibly new reports). A project that spreads `recommended` with default options sees no change.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` config object now has a `name` (`noctcore-<plugin>/recommended`), so the ESLint config inspector and config error messages show which block it is instead of an anonymous one. Nothing else about the preset changes.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0

## 0.4.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

## 0.4.1

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

## 0.4.0

### Minor Changes

- [#13](https://github.com/noctcore/eslint-plugins/pull/13) [`05c3764`](https://github.com/noctcore/eslint-plugins/commit/05c37643340ad634a8f16a9b7c3d45a218bc8f4f) Thanks [@Shironex](https://github.com/Shironex)! - New rule `no-leaky-race-timeout`, in `recommended` at `error`. It flags the hand-rolled timeout `Promise.race([work, new Promise((_, reject) => setTimeout(reject, ms))])` when the `setTimeout` handle is discarded, or kept but never passed to `clearTimeout` after the race, so the timer stays pending (and keeps a Node process alive) whenever `work` wins. A `clearTimeout` in a `finally`, in a `.finally(...)` on the race, or after the awaited race counts as a fix, as does switching to `AbortSignal.timeout(ms)`. It leaves alone races without a timer, a `setTimeout` imported from `node:timers/promises`, and handles it cannot follow. A project that spreads `recommended` as-is will see new errors wherever it races an uncleared timer.

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

- [`cf4a5be`](https://github.com/noctcore/eslint-plugins/commit/cf4a5be8b0e57699b2b3b3f95f04dc6c1970acb3) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` presets no longer ship any rule at `warn`. House policy is `error` or `off`: a
  warning is a rule nobody obeys. A test in each package now fails if a preset emits `warn` again.

  `@noctcore/eslint-plugin-async-safety`:

  - `forward-abort-signal`: `warn` to `error`. A dead `signal` parameter is a real bug, and the rule
    already counts any forwarding shape as a pass.
  - `no-concurrent-shared-mutation`: `warn` to `error`. A lost update is a real bug, and the rule
    already skips order-tolerant writes and plain overwrites.
  - `prefer-parallel-awaits`: `warn` to `off`. It is a latency hint, not a correctness bug, and
    sequential awaits are often deliberate (one transaction client, rate limits, ordered test setup).
    Enable it yourself where you want the nudge.

  `@noctcore/eslint-plugin-observability`:

  - `no-sensitive-fields-in-logs`: `warn` to `error`. A miss leaks a credential into a long-lived log
    sink; a false positive costs a rename or an explicit `redact()`. Turn it off in config for tests
    that log a secret on purpose to prove a redaction boundary.

  This can surface new errors in projects that use the preset as-is, hence the minor bump.

## 0.2.0

### Minor Changes

- [`73168a1`](https://github.com/noctcore/eslint-plugins/commit/73168a1970e09c4543b29f88e8616ec12a270bdb) Thanks [@Shironex](https://github.com/Shironex)! - Add `require-client-timeout`: reports a configured client call or `new` whose options object literal sets none of the listed timeout keys. It ships with no built-in client list (`clients: []`, inert by default) and, like `require-fetch-timeout`, stays silent on spreads and opaque option bags. Enabled at `error` in `recommended`.
