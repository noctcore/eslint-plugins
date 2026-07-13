# `noctcore-code-quality/prefer-early-return`

> Prefer a guard clause over wrapping the whole function body in an `if`.

## Why

When a function's entire body is wrapped in a single `if` with no `else`, the happy path is
needlessly indented and the reader has to hold the condition in their head to the end. Inverting
the condition into an early return keeps the meaningful work at the top level and reads top-to-bottom.

## What it flags

The **last** statement of a function block that is an `if` with:

- no `else` branch, and
- a block consequent holding **two or more** statements.

A single-statement `if`, an `if/else`, or an `if` that is not the final statement is left alone —
those are not body-wraps.

```ts
// ✗ the whole body is wrapped
function handle(x) {
  if (x) {
    doA();
    doB();
  }
}

// ✓ guard clause
function handle(x) {
  if (!x) {
    return;
  }
  doA();
  doB();
}
```

## Options

None.

## When not to use it

If you prefer the wrapped style, or lint a codebase where trailing single-`if` bodies are idiomatic,
disable it.
