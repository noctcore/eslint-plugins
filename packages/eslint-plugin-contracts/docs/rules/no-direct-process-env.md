# `noctcore-contracts/no-direct-process-env`

> Read environment variables through a typed, validated config accessor — never `process.env` directly.

## Why

`process.env.X` is `string | undefined`, unvalidated, and reachable from anywhere. A typo or a missing
variable fails silently at the point of use, often deep in a request. Funnelling every read through a
single typed config module makes the environment a validated contract that fails **at boot**, and
gives every consumer real types.

## What it flags

Any `process.env` access, in every position — property read (`process.env.X`), computed
(`process.env[X]`), destructure (`const { X } = process.env`), or the bare value passed / returned /
assigned (`log(process.env)`, `return process.env`). Computed `process['env']` cannot bypass it.

```ts
// ✗
const isProd = process.env.NODE_ENV === 'production';
const { DATABASE_URL } = process.env;
const env = process['env'];

// ✓
const isProd = config.isProduction;
```

Files matched by the `allowedFiles` glob allowlist are skipped entirely, so bootstrap entrypoints,
config files, and tests may still read `process.env` directly.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configModule` | `string` | `'@/config'` | Import path of the typed config accessor, named in the report message. |
| `allowedFiles` | `string[]` (globs) | `['**/*.config.{ts,js,mjs,cjs}', '**/*.{spec,test}.{ts,tsx}', '**/scripts/**']` | Files permitted to read `process.env` directly. |

Globs support `*`, `**`, `?`, and `{a,b}` alternation; a leading `**/` matches any (or no) directory
prefix, so patterns work against both relative and absolute filenames.

```js
'noctcore-contracts/no-direct-process-env': ['error', {
  configModule: '@acme/config',
  allowedFiles: ['**/apps/server/**', '**/*.{spec,test}.{ts,tsx}'],
}]
```

## When not to use it

If you have no config seam yet, or intentionally read `process.env` throughout (a small script, a
Vite-style `import.meta.env` app), leave this rule off or widen `allowedFiles`.
