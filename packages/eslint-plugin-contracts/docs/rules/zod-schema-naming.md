# `noctcore-contracts/zod-schema-naming`

> Every exported zod schema is a PascalCase const suffixed `Schema`, paired with a same-named inferred type.

## Why

A contracts package is a shared spine. A uniform `FooSchema` + `Foo` pairing keeps the schema and
its TypeScript type discoverable and prevents a hand-authored duplicate type from drifting away from
the schema it is supposed to mirror.

## What it flags

For every `export const` whose initializer is rooted at the `z` identifier (`z.object(...)`,
`z.string().min(1)`, `z.union([...])`, …):

- the const name must match `^[A-Z][A-Za-z0-9]*Schema$` — otherwise `schemaNaming`;
- a correctly-named `FooSchema` must have a sibling `export type Foo` (a `type` alias or
  `interface`) — otherwise `missingType`.

```ts
// ✗ not suffixed `Schema`
export const Task = z.object({});

// ✗ no sibling inferred type
export const TaskSchema = z.object({});

// ✓
export const TaskSchema = z.object({ id: z.string() });
export type Task = z.infer<typeof TaskSchema>;
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `roleSuffixes` | `string[]` | `[]` | Const-name suffixes that opt a schema **out** of the `*Schema` rule (their naming is owned by [`wire-message-naming`](./wire-message-naming.md)). |

With the default empty list the base convention applies to every exported zod schema. Codebases that
model wire messages as `*Event` / `*Command` / `*Query` discriminated-union members pass those
suffixes to carve them out:

```js
'noctcore-contracts/zod-schema-naming': ['error', { roleSuffixes: ['Event', 'Command', 'Query'] }]
```

```ts
// carved out only when 'Command' is listed in roleSuffixes
export const RunTaskCommand = z.object({ type: z.literal('run-task') });
```

## When not to use it

If your codebase does not import zod as `z`, or does not pair schemas with inferred types, this rule
will not fit — it keys off the `z` root identifier and the `FooSchema`/`Foo` pairing convention.
