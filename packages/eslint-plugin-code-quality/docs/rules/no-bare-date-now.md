# `noctcore-code-quality/no-bare-date-now`

> Read wall-clock time through a mockable `clock` util, not bare `Date.now()` / `new Date()`.

## Why

Business logic that reads `Date.now()` or `new Date()` directly is hard to test: every time-dependent
branch depends on the real clock. Routing wall-clock reads through a shared `clock` util
(`nowMs()` / `now()`) gives time-dependent code one seam you can freeze or advance in tests.

## What it flags

- `Date.now()` → suggests `nowMs()`.
- Zero-argument `new Date()` → suggests `now()`.

`new Date(value)` with an argument is a **parse** of an explicit instant, not a bare clock read, and
is never flagged. Files covered by `allowIn` are skipped entirely.

```ts
// ✗ bare clock reads in business logic
const start = Date.now();
const created = new Date();

// ✓ through the clock seam
const start = nowMs();
const created = now();

// ✓ parsing an explicit instant
const at = new Date('2026-01-01T00:00:00Z');
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `["**/clock.ts", "**/clock/**"]` | File-path globs (infra / the clock util itself) where bare `Date` is allowed. |

```js
'noctcore-code-quality/no-bare-date-now': ['error', { allowIn: ['**/clock.ts', '**/*.timing.ts'] }]
```

## When not to use it

If your project has no clock abstraction and does not intend to add one.
