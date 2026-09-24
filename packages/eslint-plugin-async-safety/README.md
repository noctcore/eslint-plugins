# @noctcore/eslint-plugin-async-safety

**Docs:** [noctcore.github.io/eslint-plugins/packages/async-safety](https://noctcore.github.io/eslint-plugins/packages/async-safety/)

Async-correctness rules TypeScript can't catch: unbounded `fetch`, dropped `AbortSignal`s, and
shared-state / concurrency races. Flat-config only, ESLint 9+.

## Requirements

- ESLint 9 or newer, flat config (`eslint.config.js`) only.
- `configs.recommended` registers the plugin and sets rule severities, nothing else. It sets no
  `files` and no parser, so it applies to whatever files the rest of your config lints. To lint
  TypeScript, add a `files` pattern and `@typescript-eslint/parser`:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import asyncSafety from '@noctcore/eslint-plugin-async-safety';

export default [
  {
    ...asyncSafety.configs.recommended,
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
];
```

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
| [`require-client-timeout`](./docs/rules/require-client-timeout.md) | A configured network client (`new S3Client(...)`, `nodemailer.createTransport(...)`) must be built with one of its timeout options. Ships with no client list. | |
| [`forward-abort-signal`](./docs/rules/forward-abort-signal.md) | A function that accepts an `AbortSignal` but awaits a call without forwarding it leaves that work uncancellable. | |
| [`no-shared-mutable-module-state`](./docs/rules/no-shared-mutable-module-state.md) | A module-scoped mutable binding written from an exported async/handler function is shared across concurrent requests (opt in via `include`). | |
| [`prefer-parallel-awaits`](./docs/rules/prefer-parallel-awaits.md) | Consecutive independent awaits can run concurrently with `Promise.all`. | 💡 |
| [`no-concurrent-shared-mutation`](./docs/rules/no-concurrent-shared-mutation.md) | A read-modify-write of an outer binding inside a concurrent `Promise.all(map(async …))` callback can lose updates. | |
| [`no-leaky-race-timeout`](./docs/rules/no-leaky-race-timeout.md) | A `setTimeout` timeout raced with `Promise.race` must be cleared, or the timer outlives the race whenever the other promise wins. | |

## `recommended` preset

| Rule | Severity | Notes |
| --- | --- | --- |
| `require-fetch-timeout` | `error` | Precise and syntactic. |
| `require-client-timeout` | `error` | Inert until you list `clients`, so it ships enabled but checks nothing by default. |
| `no-shared-mutable-module-state` | `error` | Inert until you set `include` globs, so it ships enabled but off by default. |
| `forward-abort-signal` | `error` | A dead `signal` is a real bug; any forwarding shape counts as a pass. |
| `no-concurrent-shared-mutation` | `error` | A lost update is a real bug; order-tolerant writes are skipped. |
| `no-leaky-race-timeout` | `error` | A timer left pending after the race is a real leak; any clear after the race counts as a pass. |
| `prefer-parallel-awaits` | `off` | A latency hint, not a bug. Sequential awaits are often deliberate. Opt in where you want it. |

Every rule is `error` or `off`, never `warn`: a warning is a rule nobody obeys.

The 💡 rules provide editor suggestions (not autofixes) — parallelizing awaits and adding a timeout both change
runtime behavior, so they are never applied automatically.
