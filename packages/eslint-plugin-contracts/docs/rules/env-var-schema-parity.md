# `noctcore-contracts/env-var-schema-parity`

> Every `process.env.FOO` / `import.meta.env.FOO` key must be declared in a schema file.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

An env var that is read in code but declared nowhere is config drift waiting to fail in production:
nothing documents it, nothing validates it, and nothing provisions it in a fresh environment. A typo
(`process.env.DATABSE_URL`) reads `undefined` and fails deep in a request. Cross-checking every access
against a single schema file — a `.env.example` or a zod-env module — keeps config access and config
declaration in lockstep.

## What it flags

A static `process.env.FOO` or `import.meta.env.FOO` access whose key `FOO` is not declared in the
configured schema file:

```ts prose reason="the rule reads the schema file named in its options from disk"
// schema (.env.example) declares DATABASE_URL, PORT, NODE_ENV

// ✗
const secret = process.env.MISSING_KEY;
const flag = import.meta.env.ALSO_MISSING;

// ✓
const url = process.env.DATABASE_URL;
const port = import.meta.env.PORT;
```

## What it does not flag

- Computed reads such as `process.env[dynamicKey]`: only static `.FOO` accesses are policed.
- Destructured reads (`const { FOO } = process.env`).
- Anything at all when `schema` is unset, or when the schema file cannot be read: the rule goes inert
  rather than flagging every access.

### Edits to other files

This rule also reads the env schema file, so its result can change when that file does.
`eslint --cache` does not notice and keeps the old result until the linted file itself changes. A
long-running editor server keeps the first read until it restarts, so restart it after changing that
file. See [Rules that read other
files](https://noctcore.github.io/eslint-plugins/filesystem-rules/).

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
