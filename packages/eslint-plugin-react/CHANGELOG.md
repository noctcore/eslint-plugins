# @noctcore/eslint-plugin-react

## 0.4.0

### Minor Changes

- [`42ecbd9`](https://github.com/noctcore/eslint-plugins/commit/42ecbd9f98a51d9377530770a44873b4cb0ba80e) Thanks [@Shironex](https://github.com/Shironex)! - New rule `no-unguarded-web-storage`, shipped as `error` in `recommended`.

  A `localStorage` / `sessionStorage` call must sit inside a `try` block. The property access
  itself throws when storage is disabled (private browsing, blocked cookies, a sandboxed iframe,
  storage partitioning), and `setItem` throws on an exhausted quota. The code compiles and the
  tests pass under jsdom, then the exception lands in a render for a slice of real users.

  The rule flags any storage method call, written bare or through `window.`, `globalThis.` or
  `self.`, with no enclosing `try` at any depth. A `typeof window === 'undefined'` check is not a
  guard: it fences off the server, and the throw happens in the browser. It stays silent for a
  wrapper object, a non-call reference, a locally declared `localStorage`, storage code written as
  text inside a string, and files matched by `allowIn` (tests and specs by default). A suggestion
  wraps a plain expression or return statement in `try { ... } catch { ... }`.

  Projects that spread `react.configs.recommended` will now fail lint on an unguarded storage
  call. Wrap it, move it into a guarded helper, or exempt the path with `allowIn`.

### Patch Changes

- [`ca5f24b`](https://github.com/noctcore/eslint-plugins/commit/ca5f24b5ea45f532c60f92fdca6a77d7cf867773) Thanks [@Shironex](https://github.com/Shironex)! - `prefer-lazy-state-init` now matches storage calls written with a global prefix.

  `window.localStorage.getItem` and `localStorage.getItem` are one call written two ways, and the
  rule compared the dotted path literally, so the default `localStorage.getItem` entry saw only the
  bare form and every `window.`-prefixed call site went unreported. `window.`, `globalThis.` and
  `self.` are now stripped before matching, and an explicitly configured prefixed path still matches
  as written.

  Also corrects the security plugin's README, which wired an example rule at `warn` against the
  house policy that every rule is `error` or `off`.

## 0.3.1

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

## 0.3.0

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

## 0.2.1

### Patch Changes

- [`3cc17aa`](https://github.com/noctcore/eslint-plugins/commit/3cc17aa9c882ff1be503476536dccd6fc2197b29) Thanks [@Shironex](https://github.com/Shironex)! - `max-hook-return-surface` no longer crashes on a top-level `return` in a hook file. Its enclosing-function walk stopped only on `undefined`, but `Program.parent` is `null` at runtime, so the walk dereferenced `null` once it climbed past `Program`.

## 0.2.0

### Minor Changes

- Add 5 rules: `prefer-lazy-state-init` (fixable), `no-jsx-in-hooks`, `component-props-naming` (fixable), and conservative `warn`-level `require-effect-cancellation` and `no-effect-derived-state`.
