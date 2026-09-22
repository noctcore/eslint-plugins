# `noctcore-prisma/prisma-write-in-transaction`

> Two or more Prisma writes in one function must run inside a `$transaction`.

## Why

Two writes in a row outside a transaction are a partial-failure split-brain: the first commits, the
second throws, and the data is left half-written. Nothing in the type system or a happy-path test
notices.

## What it flags

The Nth Prisma write (default: the second) in one function body that is not lexically inside a
`$transaction(...)` call. Both transaction forms count as covered: the interactive callback
`$transaction(async (tx) => { ... })` and the array form `$transaction([ ... ])`. Counting is per
innermost function, so writes split across two methods are never added together.

A call is a Prisma write when its method is one of Prisma's writes (`create`, `createMany`,
`createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`,
`deleteMany`) **and** its receiver looks like a Prisma client: a name in the chain matches
`receiverPattern` or is one of `clientProperties`, or the chain's root is one of `txRootNames`.
That second condition keeps `createHash('sha256').update(x)` and `this.cache.delete(k)` quiet.

```ts bad
async function issue(prisma: PrismaClient) {
  await prisma.invoice.create({ data });
  await prisma.ledgerEntry.create({ data: entry }); // reported
}
```

```ts good
async function issue(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    await tx.invoice.create({ data });
    await tx.ledgerEntry.create({ data: entry });
  });
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `thresholdWrites` | `integer` (>= 2) | `2` | The Nth non-transactional write in one function is reported. |
| `receiverPattern` | `string` (regex source) | `'prisma'` | A name in the receiver chain matching this (case-insensitive) makes it a Prisma client. |
| `clientProperties` | `string[]` | `[]` | Extra property names that expose a Prisma client, e.g. `['client']` for a repository base class with a `get client()`. |
| `txRootNames` | `string[]` | `['tx']` | Root identifiers that are a transaction client, e.g. a `tx` passed into a helper. |

`clientProperties` is empty by default on purpose: `this.client` is just as often an HTTP or SDK
client (`this.client.messages.create(...)`), and recognising it by name would report that code.

```js
'noctcore-prisma/prisma-write-in-transaction': ['error', { clientProperties: ['client'] }]
```

## When not to use it

Test setup legitimately performs several writes outside a transaction. Scope the rule to
production source with a `files` / `ignores` block rather than living with the noise.
