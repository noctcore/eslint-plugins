# `noctcore-contracts/no-direct-process-env`

> Read environment variables through a typed, validated config module, never `process.env` directly.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`process.env.X` is `string | undefined`, unvalidated, and reachable from anywhere. A typo or a missing
variable fails silently at the point of use, often deep in a request. Funnelling every read through a
single typed config module makes the environment a validated contract that fails **at boot**, and
gives every consumer real types.

## What it flags

Any `process.env` access, in every position — property read (`process.env.X`), computed
(`process.env[X]`), destructure (`const { X } = process.env`), or the bare value passed / returned /
assigned (`log(process.env)`, `return process.env`). Computed `process['env']` cannot bypass it.

```ts bad reports=3
const isProd = process.env.NODE_ENV === 'production';
const { DATABASE_URL } = process.env;
const env = process['env'];
```

```ts good
import { config } from '@/config';

const isProd = config.isProduction;
```

## What it does not flag

- Files matched by the `allowedFiles` glob allowlist are skipped entirely. The default covers config
  files (`*.config.{ts,js,mjs,cjs,mts,cts}`), tests in every module flavour, and repo tooling under
  `scripts/` and `tools/`: a CLI's environment is its input, and it boots no app whose config module
  it could read through.
- `import.meta.env` reads and other `process` properties (`process.environment`, `process.argv`):
  only `process.env` itself is policed.

```ts good filename=vite.config.ts relocation
const isProd = process.env.NODE_ENV === 'production';
```

```ts good filename=tools/verify/run.ts relocation
const sandboxDir = process.env.VERIFY_DIR;
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configModule` | `string` | `'@/config'` | Import path of the validated config module, named in the report message. |
| `allowedFiles` | `string[]` (globs) | `['**/*.config.{ts,js,mjs,cjs,mts,cts}', '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '**/scripts/**', '**/tools/**']` | Files permitted to read `process.env` directly. Passing it replaces the default list. |

Globs support `*`, `**`, `?`, and `{a,b}` alternation. They are matched against the file's absolute
path and its path relative to the working directory and to the workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`), so `apps/server/**` and `**/server/**` both work.

```js
'noctcore-contracts/no-direct-process-env': ['error', {
  configModule: '@acme/config',
  allowedFiles: ['**/apps/server/**', '**/*.{spec,test}.{ts,tsx}'],
}]
```

## When not to use it

If you have no config seam yet, or intentionally read `process.env` throughout (a small script, a
Vite-style `import.meta.env` app), leave this rule off or widen `allowedFiles`.
