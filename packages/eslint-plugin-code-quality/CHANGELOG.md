# @noctcore/eslint-plugin-code-quality

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
