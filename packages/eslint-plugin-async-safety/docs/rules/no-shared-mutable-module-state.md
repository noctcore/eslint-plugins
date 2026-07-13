# `noctcore-async-safety/no-shared-mutable-module-state`

> A module-scoped mutable binding written from an exported async/handler function is shared across concurrent requests.

## Why

On a server, module scope is process-wide: every concurrent request runs against the same module-level
variables. A `let` counter or a `const cache = new Map()` written inside a request handler is not per-request
state — request B observes and overwrites what request A left behind. This leaks data across users and produces
races that never appear in single-request local testing.

## What it flags

Only when the file matches an `include` glob (see Options — the rule is **off by default**), a write to a
module-scoped mutable binding performed inside an **exported async function** or a **handler-named export**:

- a module-level `let`/`var` reassigned (`x = …`, `x += …`, `x++`); or
- a module-level mutable container `const` (`[]`, `{}`, `new Map()`/`Set()`/`WeakMap()`/`WeakSet()`) mutated
  (`c.push(…)`, `c.set(…)`, `c[i] = …`, `c.prop = …`).

Exported functions qualify when they are `async` or named like a handler (`GET`/`POST`/…, `loader`, `action`,
`handler`, `*Handler`, `middleware`).

```ts
// server.ts  (include: ['**/server/**'])

// ✗ shared across requests
let requestCount = 0;
export async function GET() {
  requestCount += 1;
}

// ✓ per-request
export async function GET() {
  const requestCount = 1;
}
```

The lazy-initialization idioms `x ??= …` and `x ||= …` are always skipped (the common singleton/memoization
pattern), and names in `allow` are exempt.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` (globs) | `[]` | Glob patterns for server files to arm the rule on. Empty = the rule does nothing. |
| `allow` | `string[]` | `[]` | Binding names to exempt (intentional singletons / process-wide caches). |

Globs support `**` (any run including `/`), `*` (any run except `/`), `?`, and a leading `**/` that also matches
zero leading segments.

```js
'noctcore-async-safety/no-shared-mutable-module-state': [
  'error',
  { include: ['**/server/**', '**/*.server.ts'], allow: ['metricsRegistry'] },
]
```

## When not to use it

Client-side modules legitimately hold shared mutable state (caches, stores, singletons). Keep `include` scoped
to server code so those are never touched.
