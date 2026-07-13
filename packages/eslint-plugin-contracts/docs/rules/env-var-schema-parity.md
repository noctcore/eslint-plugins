# `noctcore-contracts/env-var-schema-parity`

> Every `process.env.FOO` / `import.meta.env.FOO` key must be declared in a schema file.

## Why

An env var that is read in code but declared nowhere is config drift waiting to fail in production:
nothing documents it, nothing validates it, and nothing provisions it in a fresh environment. A typo
(`process.env.DATABSE_URL`) reads `undefined` and fails deep in a request. Cross-checking every access
against a single schema file — a `.env.example` or a zod-env module — keeps config access and config
declaration in lockstep.

## What it flags

A static `process.env.FOO` or `import.meta.env.FOO` access whose key `FOO` is not declared in the
configured schema file:

```ts
// schema (.env.example) declares DATABASE_URL, PORT, NODE_ENV

// ✗
const secret = process.env.MISSING_KEY;
const flag = import.meta.env.ALSO_MISSING;

// ✓
const url = process.env.DATABASE_URL;
const port = import.meta.env.PORT;
```

Only static accesses are policed. Computed (`process.env[dynamic]`) and destructured reads are left
alone.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `schema` | `string` | — | Path to the env declaration source (`.env.example` or a zod-env module). Relative paths resolve against the ESLint working directory. |

**Inert until configured.** With no `schema` the rule reports nothing. The schema is read once per
resolved path and cached for the process. The parser is format-agnostic and permissive: it unions
dotenv keys (`FOO=...`) with object-property keys (`FOO: z.string()`, `'FOO': ...`), so it accepts
both a `.env.example` and a zod-env module — and over-collection only ever suppresses a report, never
invents one. If the schema cannot be read, the rule goes inert rather than flagging every access.

```js
'noctcore-contracts/env-var-schema-parity': ['error', { schema: '.env.example' }]
// or a zod-env module:
'noctcore-contracts/env-var-schema-parity': ['error', { schema: 'src/env.ts' }]
```

## When not to use it

If you have no single schema of record for env vars, or read env dynamically by design, leave this
rule off (or unset `schema` to keep it inert).
