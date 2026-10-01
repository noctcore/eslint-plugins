---
'@noctcore/eslint-plugin-code-quality': patch
---

Close four gaps in the test-discipline rules and fix a crash.

**A project that spreads `recommended` as-is sees no new errors.** The only rule here that is in `recommended`, `no-vacuous-expect`, reports less than before. The other three rules are opt-in, and a project that enabled them can see new errors:

- `typed-mock-over-double-cast` now sees a mock that was created first and put in the object by name: `const fn = vi.fn(); const svc = { fn } as unknown as Service;`, also as `{ run: fn }`, nested in an inner object, through a chain (`jest.fn().mockResolvedValue(...)`) and when the name is assigned its mock later (`let get; beforeEach(() => { get = jest.fn(); })`). A mock that arrives through a spread, an import, a parameter or a helper's return value is still not followed.
- `no-message-only-throw-assertion` now reads a message held in a variable: `const expected = /no access/; expect(run).toThrow(expected)` is a message check, for a string, a template, a regex literal or `new RegExp(...)`, as long as the variable is initialised where it is declared and never assigned again. Such a variable no longer counts as a class pin for a later message check on the same subject either. An import, a parameter and a call result are still read as an error class.
- `no-sleep-in-unit-tests` no longer exempts a whole file because one test fakes its timers. A `fakeTimerMethods` call now covers the test it is in, else the `describe` it is in (directly or in a `beforeEach` / `beforeAll`), else the whole file, so a file that installs fake timers at the top level behaves as before. A real sleep in a sibling test or suite is reported. A sleep helper defined in the file is judged by its callers: it stays silent when every call to it runs under fake timers.

Reports less:

- `no-vacuous-expect` no longer treats a `container` / `baseElement` from any call as a render root. A root from a `render*` call still counts for every presence check. A root from another call (`setup()`, `docker.inspect(id)`) counts only when the assertion is DOM-specific: it reads `firstChild`, `innerHTML` and the like off the root, or uses `toBeInTheDocument`, `toBeVisible` or `not.toBeEmptyDOMElement`. So `const { container } = await docker.inspect(id); expect(container).not.toBeNull();` is accepted, and so is the same check on the root of a render helper whose name does not start with `render`. A weak matcher there (`toBeTruthy`, `toBeDefined`) is still reported, as `soleWeakExpect`.

Crash fixed:

- `no-sleep-in-unit-tests` threw `Cannot read properties of null (reading 'type')` on a `setTimeout(...)` call at the top level of a unit test file.
