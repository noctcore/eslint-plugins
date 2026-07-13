# @noctcore/eslint-plugin-async-safety

Async-correctness rules TypeScript can't catch: unbounded `fetch`, dropped `AbortSignal`s, and
shared-state / concurrency races. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-async-safety   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import asyncSafety from '@noctcore/eslint-plugin-async-safety';

export default [
  asyncSafety.configs.recommended,
];
```

Or wire rules individually:

```js
import asyncSafety from '@noctcore/eslint-plugin-async-safety';

export default [
  {
    plugins: { 'noctcore-async-safety': asyncSafety },
    rules: {
      'noctcore-async-safety/require-fetch-timeout': ['error', { callees: ['undici.request'] }],
      // Off until you point it at server files:
      'noctcore-async-safety/no-shared-mutable-module-state': ['error', { include: ['**/server/**'] }],
    },
  },
];
```

## Rules

| Rule | Description | 💡 |
| --- | --- | --- |
| [`require-fetch-timeout`](./docs/rules/require-fetch-timeout.md) | A `fetch` (or configured wrapper) call must carry a `signal`/`timeout` — an unbounded request can hang forever. | 💡 |
| [`forward-abort-signal`](./docs/rules/forward-abort-signal.md) | A function that accepts an `AbortSignal` but awaits a call without forwarding it leaves that work uncancellable. | |
| [`no-shared-mutable-module-state`](./docs/rules/no-shared-mutable-module-state.md) | A module-scoped mutable binding written from an exported async/handler function is shared across concurrent requests (opt in via `include`). | |
| [`prefer-parallel-awaits`](./docs/rules/prefer-parallel-awaits.md) | Consecutive independent awaits can run concurrently with `Promise.all`. | 💡 |
| [`no-concurrent-shared-mutation`](./docs/rules/no-concurrent-shared-mutation.md) | A read-modify-write of an outer binding inside a concurrent `Promise.all(map(async …))` callback can lose updates. | |

## `recommended` preset

| Rule | Severity | Notes |
| --- | --- | --- |
| `require-fetch-timeout` | `error` | Precise and syntactic. |
| `no-shared-mutable-module-state` | `error` | Inert until you set `include` globs, so it ships enabled but off by default. |
| `forward-abort-signal` | `warn` | Heuristic — advisory. |
| `prefer-parallel-awaits` | `warn` | Heuristic — advisory suggestion. |
| `no-concurrent-shared-mutation` | `warn` | Heuristic — advisory. |

The 💡 rules provide editor suggestions (not autofixes) — parallelizing awaits and adding a timeout both change
runtime behavior, so they are never applied automatically.
