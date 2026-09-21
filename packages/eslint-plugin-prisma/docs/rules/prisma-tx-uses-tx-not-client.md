# `noctcore-prisma/prisma-tx-uses-tx-not-client`

> Inside an interactive `$transaction` callback, write through the callback's `tx`, not the outer
> client.

## Why

`prisma.$transaction(async (tx) => { ... })` only makes the writes that go through `tx` atomic. A
write through the outer client inside the callback runs on a different connection: it commits even
when the transaction rolls back. The code reads as transactional and is not.

## What it flags

Inside an interactive `$transaction` callback whose first parameter is a plain identifier, any
Prisma write whose receiver chain is not rooted at that parameter, when the receiver looks like a
Prisma client (see `receiverPattern`, `clientProperties`, `txRootNames`) or is rooted at an OUTER
transaction's parameter. Nested transactions each police their own parameter. Reads are not
reported, and neither is the array form `$transaction([...])`.

```ts
// ✗
await this.prisma.$transaction(async (tx) => {
  await tx.invoice.update({ where, data });
  await this.prisma.ledgerEntry.create({ data: entry }); // escapes the rollback
});

// ✗ nested: the outer tx escapes the inner transaction
await tx.$transaction(async (inner) => {
  await tx.invoice.create({ data });
});

// ✓
await this.prisma.$transaction(async (tx) => {
  await tx.invoice.update({ where, data });
  await tx.ledgerEntry.create({ data: entry });
});
```

Report only: rewriting the receiver is not a trivially safe autofix.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `receiverPattern` | `string` (regex source) | `'prisma'` | A name in the receiver chain matching this (case-insensitive) makes it a Prisma client. |
| `clientProperties` | `string[]` | `[]` | Extra property names that expose a Prisma client, e.g. `['client']` for `this.client.invoice.create(...)`. |
| `txRootNames` | `string[]` | `['tx']` | Root identifiers that are a transaction client even when they are not the active callback's parameter, e.g. a `tx` a helper received. |

```js
'noctcore-prisma/prisma-tx-uses-tx-not-client': ['error', { clientProperties: ['client'] }]
```

## When not to use it

If you never use interactive transactions, this rule has nothing to check.
