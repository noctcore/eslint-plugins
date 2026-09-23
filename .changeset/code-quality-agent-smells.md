---
'@noctcore/eslint-plugin-code-quality': minor
---

Two new rules, both in `recommended` at `error`. A project that spreads `recommended` as-is will see
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
