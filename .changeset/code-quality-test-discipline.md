---
'@noctcore/eslint-plugin-code-quality': minor
---

Four new opt-in test-discipline rules and two stricter existing rules.

**A project that spreads `recommended` sees new errors from two rules it already runs:**

- `no-vacuous-expect` now reports a test whose only assertion is that the render root is present (`soleRenderRootExpect`): `expect(container).not.toBeEmptyDOMElement()`, `expect(container.firstChild).toBeInTheDocument()`, `expect(container.innerHTML).not.toBe('')` and the like, on `container` or `baseElement`. Such a test passes for anything that renders, an error fallback included. Assert on a role, a label or a text instead, or set the new `renderRoots` option to `[]` to keep the old behaviour.
- `skipped-tests-need-tracking` now also reads `node:test` skips: a `{ skip: true }`, `{ skip: 'reason' }` or `{ todo: ... }` option on `test` / `it` / `describe` / `suite` (and a `t.test` subtest), and `t.skip()` / `t.todo()` as a statement of the test callback's own body. Only unconditional skips are reported: a computed value (`{ skip: process.platform === 'win32' }`, `{ skip: !ready }`) or a `t.skip(...)` inside an `if` is a platform guard and stays silent. Add an issue URL or `TODO(@owner)` near the skip, as for `.skip(`.

**New rules, left out of `recommended`** (each needs a per-project fact; enabling them is up to you):

- `no-message-only-throw-assertion`: `toThrow()` / `toThrowError()` with no argument, or with only a string, template or regex, sync or after `.rejects`. Any error passes those, including a `TypeError` from a broken mock. A class argument, an asymmetric matcher, `.rejects.toMatchObject(...)` and `.not.toThrow()` are fine, and a message-only assertion is accepted when the same test pins the class of the same subject in the same or an enclosing block (a bare `toThrow()` is never excused that way). Options: `throwMatchers`, `allowMessageOnly` (report only the argless form), `trustErrorInstances` (set `false` under Jest, where `toThrow(new X('m'))` compares only the message) and `assertionHelpers`.
- `no-sleep-in-unit-tests`: a real sleep in a unit test file: `new Promise((r) => setTimeout(r, n))`, `setTimeout` from `timers/promises`, and `promisify(setTimeout)`. A zero or omitted delay (`allowZeroDelay`, on by default) a reject-only timeout guard and a deadline whose handle is kept for `clearTimeout` are not sleeps, and a file that installs fake timers (`fakeTimerMethods`, default `useFakeTimers`) is not checked, since its waits are virtual. Same `testFileSuffixes` / `integrationMarkers` options as `no-real-network-in-unit-tests`.
- `no-real-clock-in-unit-tests`: `Date.now()`, an argless `new Date()` and `Date()` in a unit test file that never fakes the clock (`useFakeTimers`, `setSystemTime`, a `Date.now` spy, or a mocked module matching `clockModules`). An offset from now (`Date.now() + 60_000`, `new Date().getTime() - 1000`) is allowed.
- `typed-mock-over-double-cast`: an object literal containing `jest.fn()` / `vi.fn()` cast `as unknown as T` (or `as any as T`). Type it as `jest.Mocked<Pick<T, ...>>` or check it with `satisfies`. Options: `mockFactories`, `allowTargets` for types too wide to `Pick` from.
