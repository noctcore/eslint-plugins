# @noctcore/eslint-plugin-code-quality

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#90](https://github.com/noctcore/eslint-plugins/pull/90) [`f1e42a9`](https://github.com/noctcore/eslint-plugins/commit/f1e42a973fb62b0e83f870175099725c534d2121) Thanks [@Shironex](https://github.com/Shironex)! - Fix false positives and false negatives in five `recommended` rules, and add two editor suggestions.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - `skipped-tests-need-tracking` reads the tracking marker from comments only. Before, any text in the 30 lines above a skip counted, so a `const BASE = 'http://localhost:3000'` near the top of a test file exempted every skip below it. A marker now has to be in a comment on the skip's line, or in a comment that ends within `lookback` lines above it (the whole run of adjacent comment lines counts, so a URL at the top of a long `//` explanation still works). The `lookback` default drops from 30 to 3. A `node:test` reason given as text (`{ skip: 'https://...' }`) still counts. It now also reports a skip modifier anywhere in the chain: `it.concurrent.skip(...)` and `it.skip.each([...])(...)`. To keep the old window, set `lookback: 30`.
  - `no-bare-date-now` now reports `Date()` called as a function and reads through the global object (`globalThis.Date.now()`, `new window.Date()`).
  
  **Reports less:**
  
  - `no-bare-date-now` exempts test files by default (`**/*.{spec,test}.*`, `**/__tests__/**`), like the other allowlisted rules. A project that sets `allowIn` replaces the default and sees no change. The messages no longer present `now()` / `nowMs()` as names the project must have.
  - `skipped-tests-need-tracking` no longer reports Playwright's conditional skip, `test.skip(browserName === 'webkit', 'reason')`. `test.skip()` and `test.skip(true, 'reason')` are still reported.
  - `no-historical-comments` no longer reports `no longer` describing runtime state ("the socket is no longer writable") or `historical` as a domain word ("historical exchange rates"). `we no longer`, `no longer needed/used/required/...` and `historically` are still reported.
  - `no-focused-tests` no longer reports `.only` read as a value (`RuleTester.itOnly = it.only`, the usual Vitest wiring for typescript-eslint's `RuleTester`); a called chain such as `it.only.each([...])(...)` is still reported.
  - `no-pr-reference-comments` no longer reports a bare `#` number with one digit (`step [#2](https://github.com/noctcore/eslint-plugins/issues/2)`), a leading zero (`#000`), or a following `%` or letter. A new `trackerPatterns` option reports tracker keys such as Jira's (`['(?:OPS|WEB)-\\d+']`); it is empty by default.
  
  **Suggestions:** `no-focused-tests` suggests removing `.only` (or `fit` to `it`), and `skipped-tests-need-tracking` suggests inserting a `// TODO(@owner):` line above the skip. Both are suggestions, not autofixes.

- [#179](https://github.com/noctcore/eslint-plugins/pull/179) [`76b921c`](https://github.com/noctcore/eslint-plugins/commit/76b921c3796e7bf970447a4c2fcc6453a1418b38) Thanks [@Shironex](https://github.com/Shironex)! - **Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-code-quality/strict`): `recommended` plus the house rules. `prefer-early-return` (a style preference with no fix) and `no-bare-date-now` (asks for a project clock seam) leave `recommended` and are on in `strict`. `prefer-early-return` is also retyped from `problem` to `suggestion`, since it reports style, not a defect.
  
  Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.
  
  - `prefer-early-return`: 31 / 49 / 86 / 53
  - `no-bare-date-now`: 26 / 104 / 110 / 76
  
  `interface-prefix-i` and `no-template-trim-empty-ternary` stay opt-in and are not in `strict` (`interface-prefix-i` contradicts react's `component-props-naming`). To keep linting as before, spread `codeQuality.configs.strict` where you spread `codeQuality.configs.recommended`, or enable the two rules by name.

- [#184](https://github.com/noctcore/eslint-plugins/pull/184) [`13855bb`](https://github.com/noctcore/eslint-plugins/commit/13855bbb9d320ad385a20a80825228b475563c70) Thanks [@Shironex](https://github.com/Shironex)! - New preset `configs.tests`: the test-discipline rules of `recommended` (`no-focused-tests`, `skipped-tests-need-tracking`, `no-vacuous-expect`, `no-conditional-expect`, `no-swallowed-assertion`, `fake-timers-must-be-restored`, `no-real-network-in-unit-tests`) with `files` set to `**/*.{test,spec}.*` and `**/__tests__/**` in every JS and TS extension, so a project scopes the test rules without hand-written globs:
  
  ```js
  export default [{ ...codeQuality.configs.tests, languageOptions: { parser: tsParser } }];
  ```
  
  `recommended` and `strict` are unchanged; a project that spreads `recommended` sees no difference.

- [#173](https://github.com/noctcore/eslint-plugins/pull/173) [`55481fe`](https://github.com/noctcore/eslint-plugins/commit/55481feba8d28a6215b31802e1561a76b994566b) Thanks [@Shironex](https://github.com/Shironex)! - Add `prefer-web-first-page-assertions`: reports `expect(page.url())` and `expect(await page.title())` in Playwright specs, which check the page once, and suggests the retrying `await expect(page).toHaveURL(...)` / `toHaveTitle(...)` where the rewrite keeps the meaning. Opt-in, enable it for your spec files.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#173](https://github.com/noctcore/eslint-plugins/pull/173) [`cdbdf21`](https://github.com/noctcore/eslint-plugins/commit/cdbdf2115b2ea51f3e1dd41715abe8089377f964) Thanks [@Shironex](https://github.com/Shironex)! - `no-vacuous-expect`, `no-message-only-throw-assertion` and `typed-mock-over-double-cast` match callees through the shared `@noctcore/eslint-utils` helpers. A member chain rooted at an identifier is now matched by its full dotted path, so `assert.strict.equal(...)` counts as an assertion under the default `^assert`, and a configured `testing.mocks.fn` or `helpers.errors.expectRejects` matches. A member call on anything else is still matched as `.name`.

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

## 0.4.2

### Patch Changes

- [#64](https://github.com/noctcore/eslint-plugins/pull/64) [`aa1ae71`](https://github.com/noctcore/eslint-plugins/commit/aa1ae71b9db4eea014323e83bb615eeab04a201d) Thanks [@Shironex](https://github.com/Shironex)! - `skipped-tests-need-tracking` no longer reports the text of a skip that is not a call.
  
  **Reports less.** The rule found `it.skip(`, `test.fixme(`, `xit(`, `xdescribe(` and `xtest(` by scanning each source line, so the same text inside a string, a template literal or a comment was reported as a skipped test. It now reads the skip from the call itself. A test file that lints probe code held as a string (a config wiring test with seeded violations, a `RuleTester` suite for a wrapper rule) can spell a skipped test in its own source, and a comment can mention `it.skip(` in prose.
  
  Every real skip that was reported before is still reported: the `.skip` / `.fixme` modifier on `it`, `test` or `describe` (also reached through a member, `test.describe.skip(`), and the `xit` / `xdescribe` / `xtest` aliases. The tracking marker is still looked up in the source text of the lookback window, so a marker in a comment counts as before.
  
  The report now sits on the callee (`it.skip`, `xit`) or on the `node:test` option, where it used to cover the whole line from column 1. The line is unchanged, so an `eslint-disable-next-line` keeps working.

## 0.4.1

### Patch Changes

- [#61](https://github.com/noctcore/eslint-plugins/pull/61) [`9f24ad7`](https://github.com/noctcore/eslint-plugins/commit/9f24ad7dd37c70b760041fe6f3e945e90ba35b97) Thanks [@Shironex](https://github.com/Shironex)! - Close four gaps in the test-discipline rules and fix a crash.
  
  **A project that spreads `recommended` as-is sees no new errors.** The only rule here that is in `recommended`, `no-vacuous-expect`, reports less than before. The other three rules are opt-in, and a project that enabled them can see new errors:
  
  - `typed-mock-over-double-cast` now sees a mock that was created first and put in the object by name: `const fn = vi.fn(); const svc = { fn } as unknown as Service;`, also as `{ run: fn }`, nested in an inner object, through a chain (`jest.fn().mockResolvedValue(...)`) and when the name is assigned its mock later (`let get; beforeEach(() => { get = jest.fn(); })`). A mock that arrives through a spread, an import, a parameter or a helper's return value is still not followed.
  - `no-message-only-throw-assertion` now reads a message held in a variable: `const expected = /no access/; expect(run).toThrow(expected)` is a message check, for a string, a template, a regex literal or `new RegExp(...)`, as long as the variable is initialised where it is declared and never assigned again. Such a variable no longer counts as a class pin for a later message check on the same subject either. An import, a parameter and a call result are still read as an error class.
  - `no-sleep-in-unit-tests` no longer exempts a whole file because one test fakes its timers. A `fakeTimerMethods` call now covers the test it is in, else the `describe` it is in (directly or in a `beforeEach` / `beforeAll`), else the whole file, so a file that installs fake timers at the top level behaves as before. A real sleep in a sibling test or suite is reported. A sleep helper defined in the file is judged by its callers: it stays silent when every call to it runs under fake timers.
  
  Reports less:
  
  - `no-vacuous-expect` no longer treats a `container` / `baseElement` from any call as a render root. A root from a `render*` call still counts for every presence check. A root from another call (`setup()`, `docker.inspect(id)`) counts only when the assertion is DOM-specific: it reads `firstChild`, `innerHTML` and the like off the root, or uses `toBeInTheDocument`, `toBeVisible` or `not.toBeEmptyDOMElement`. So `const { container } = await docker.inspect(id); expect(container).not.toBeNull();` is accepted, and so is the same check on the root of a render helper whose name does not start with `render`. A weak matcher there (`toBeTruthy`, `toBeDefined`) is still reported, as `soleWeakExpect`.
  
  Crash fixed:
  
  - `no-sleep-in-unit-tests` threw `Cannot read properties of null (reading 'type')` on a `setTimeout(...)` call at the top level of a unit test file.

## 0.4.0

### Minor Changes

- [#53](https://github.com/noctcore/eslint-plugins/pull/53) [`954f5b2`](https://github.com/noctcore/eslint-plugins/commit/954f5b245b86ebf619556b17dc1d126817f2dbe8) Thanks [@Shironex](https://github.com/Shironex)! - Four new opt-in test-discipline rules and two stricter existing rules.
  
  **A project that spreads `recommended` sees new errors from two rules it already runs:**
  
  - `no-vacuous-expect` now reports a test whose only assertion is that the render root is present (`soleRenderRootExpect`): `expect(container).not.toBeEmptyDOMElement()`, `expect(container.firstChild).toBeInTheDocument()`, `expect(container.innerHTML).not.toBe('')` and the like, on a `container` or `baseElement` bound from a call (`const { container } = render(...)`, `view.container`, `render(...).container`). Such a test passes for anything that renders, an error fallback included. Assert on a role, a label or a text instead, or set the new `renderRoots` option to `[]` to keep the old behaviour.
  - `skipped-tests-need-tracking` now also reads `node:test` skips: a `skip` or `todo` option whose value is a truthy literal (`{ skip: true }`, `{ skip: 'reason' }`, `{ todo: 1 }`) on `test` / `it` / `describe` / `suite` (and a `t.test` subtest), and `t.skip()` / `t.todo()` (awaited or not) as a statement of the test callback's own body. Only unconditional skips are reported: a computed value (`{ skip: process.platform === 'win32' }`, `{ skip: !ready }`) or a `t.skip(...)` inside an `if` is a platform guard and stays silent. Add an issue URL or `TODO(@owner)` near the skip, as for `.skip(`.
  
  **New rules, left out of `recommended`** (each needs a per-project fact; enabling them is up to you):
  
  - `no-message-only-throw-assertion`: `toThrow()` / `toThrowError()` with no argument, or with only a string, template or regex, and the message snapshots `toThrowErrorMatchingSnapshot()` / `toThrowErrorMatchingInlineSnapshot()`, sync or after `.rejects`. Any error passes those, including a `TypeError` from a broken mock. A class argument, an asymmetric matcher, `.rejects.toMatchObject(...)` and `.not.toThrow()` are fine, and a message-only assertion is accepted when the same test pins the class of the same subject in the same or an enclosing block (a bare `toThrow()` is never excused that way). Options: `throwMatchers`, `allowMessageOnly` (report only the argless form), `trustErrorInstances` (set `false` under Jest, where `toThrow(new X('m'))` and `.rejects.toEqual(new X('m'))` compare only the message; a `.rejects.toMatchObject({ message })` or `toHaveProperty('message')` is never a class pin) and `assertionHelpers`.
  - `no-sleep-in-unit-tests`: a real sleep in a unit test file: `new Promise((r) => setTimeout(r, n))`, `setTimeout` from `timers/promises`, and `promisify(setTimeout)`. A zero or omitted delay (`allowZeroDelay`, on by default) a reject-only timeout guard and a deadline whose kept handle the file passes to `clearTimeout` are not sleeps, and a file that installs fake timers (`fakeTimerMethods`, default `useFakeTimers`) is not checked, since its waits are virtual. Same `testFileSuffixes` / `integrationMarkers` options as `no-real-network-in-unit-tests`.
  - `no-real-clock-in-unit-tests`: `Date.now()`, an argless `new Date()` and `Date()` in a unit test file that never fakes the clock (`useFakeTimers`, `setSystemTime`, a `Date.now` spy, a stubbed or replaced global `Date`, or a mocked module matching `clockModules`). An offset from now (`Date.now() + 60_000`, `new Date().getTime() - 1000`) is allowed.
  - `typed-mock-over-double-cast`: an object literal containing `jest.fn()` / `vi.fn()` cast `as unknown as T` (or through `any` or `never`, in `as` or angle-bracket form). Type it as `jest.Mocked<Pick<T, ...>>` or check it with `satisfies`. Options: `mockFactories`, `allowTargets` for types too wide to `Pick` from.

## 0.3.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

## 0.3.1

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

## 0.3.0

### Minor Changes

- [#20](https://github.com/noctcore/eslint-plugins/pull/20) [`deef86a`](https://github.com/noctcore/eslint-plugins/commit/deef86ac5b3b84dbbb358ee828d50c7270a0af54) Thanks [@Shironex](https://github.com/Shironex)! - Two new rules, both in `recommended` at `error`. A project that spreads `recommended` as-is will see
  new errors wherever either pattern is present.

  - `no-elided-code-comments` flags comments whose whole text is an elided-code placeholder:
    `// ... existing code ...`, `/* rest of the function unchanged */`, `// ... other methods ...`,
    `// your code here`, `// (unchanged)`. They are what an agent leaves when it writes a whole file
    from an abbreviated draft, and the code they stand for has usually been deleted. An ellipsis in
    ordinary prose, commented-out spread syntax, a bare `/* ... */`, JSDoc blocks (including
    `@example` code) and `TODO`/`FIXME` comments are left alone.
  - `no-swallowed-assertion` flags an `expect(...)` or `assert(...)` inside a `try`, in a test or
    hook callback, whose `catch` neither rethrows, asserts, calls `fail()`, nor uses the caught error
    for anything but a `console.*` call; and a `.catch()` that swallows an `expect(...).rejects` or
    `.resolves` chain. Either way the failed assertion is dropped and the test passes. `try/finally`,
    expects inside the `catch` (that is `no-conditional-expect`), and retry loops that throw or
    assert after the last attempt are left alone.

## 0.2.2

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

## 0.2.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.2.0

### Minor Changes

- [`11a7e3d`](https://github.com/noctcore/eslint-plugins/commit/11a7e3d6dbafbdad16398d3d7b01a88a8806d736) Thanks [@Shironex](https://github.com/Shironex)! - Add four test-hygiene rules ported from tsforge (MIT), all on in `recommended`: `no-vacuous-expect`, `no-conditional-expect`, `fake-timers-must-be-restored` and `no-real-network-in-unit-tests`. `fake-timers-must-be-restored` accepts a restore that lives in a shared suite the file imports and calls (`followImportedSuites`, `sharedSuiteModules`). `no-conditional-expect` does not treat loops as conditional unless `checkLoops` is set.
