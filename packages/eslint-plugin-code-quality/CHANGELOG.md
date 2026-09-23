# @noctcore/eslint-plugin-code-quality

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
