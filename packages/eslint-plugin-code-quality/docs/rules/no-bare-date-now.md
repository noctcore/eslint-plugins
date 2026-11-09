# `noctcore-code-quality/no-bare-date-now`

> Read wall-clock time through a mockable `clock` util, not bare `Date.now()` / `new Date()`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Business logic that reads `Date.now()` or `new Date()` directly is hard to test: every time-dependent
branch depends on the real clock. Routing wall-clock reads through a shared `clock` util
(`nowMs()` / `now()`) gives time-dependent code one seam you can freeze or advance in tests.

## What it flags

- `Date.now()` → suggests `nowMs()`.
- Zero-argument `new Date()` → suggests `now()`.
- `Date()` called as a function, which returns the current time as a string.
- The same reads through the global object: `globalThis.Date.now()`, `new window.Date()`.

```ts bad reports=2
// bare clock reads in business logic
const start = Date.now();
const created = new Date();
```

```ts good
import { now, nowMs } from './clock';

// through the clock seam
const start = nowMs();
const created = now();

// parsing an explicit instant
const at = new Date('2026-01-01T00:00:00Z');
```

## What it does not flag

- `new Date(value)` with an argument: that is a **parse** of an explicit instant, not a bare clock read.
- Files covered by `allowIn`, which by default is the clock util itself (`**/clock.ts`, `**/clock/**`) and
  test files (`**/*.{spec,test}.*`, `**/__tests__/**`), which fake the clock rather than inject it.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `["**/clock.ts", "**/clock/**", "**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "**/__tests__/**"]` | File-path globs (infra, the clock util itself, tests) where bare `Date` is allowed. Setting it replaces the default, so list test globs again if you want them. |

```js
'noctcore-code-quality/no-bare-date-now': ['error', { allowIn: ['**/clock.ts', '**/*.timing.ts'] }]
```

## When not to use it

If your project has no clock abstraction and does not intend to add one.
