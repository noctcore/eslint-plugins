# `noctcore-code-quality/no-focused-tests`

> Ban `.only` / `fdescribe` / `fit` so a focused test never silently lands in CI.

## Why

A focused test (`it.only`, `fdescribe`, …) silences the rest of the suite. Committed by accident it
turns a green CI run into a lie — the suite "passes" because almost none of it ran. This rule makes a
focused test a lint error so it can't merge.

## What it flags

- `.only` resolved back to a `it` / `describe` / `test` runner, including chained modifiers
  (`test.concurrent.only`, `describe.concurrent.only`).
- The Jest/Jasmine focused-call forms `fdescribe(...)`, `fit(...)`, `ddescribe(...)` — but only as a
  bare-identifier callee, so an unrelated `obj.fit(...)` method is not flagged.

```ts
// ✗ it.only('runs', () => {});
// ✗ test.concurrent.only('case', () => {});
// ✗ fdescribe('suite', () => {});

// ✓ it('runs', () => {});
// ✓ layout.fit('contain');   // not a test runner
```

## Options

None.

## When not to use it

You almost always want this on. Disable only in throwaway scratch suites.
