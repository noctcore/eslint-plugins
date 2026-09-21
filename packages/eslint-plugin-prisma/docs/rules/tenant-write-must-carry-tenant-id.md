# `noctcore-prisma/tenant-write-must-carry-tenant-id`

> A create on a tenant-scoped model through the unscoped client must set every tenant column in
> `data`.

## Why

A tenant-scoping client extension fills in `tenantId` on every create. The unscoped client does not,
so a row created through it without the tenant column is orphaned (or fails a `NOT NULL` at runtime,
if you are lucky) and a row created with the wrong one lands in another tenant.

## What it flags

A `create`, `createMany` or `createManyAndReturn` on a model named in `tenantModels`, through the
unscoped client (a chain containing `.<unscopedProperty>`, or a local bound to it), whose `data`
**provably** lacks one of `tenantFields`:

- `data: { ... }` without the field;
- `data: [{ ... }, ...]` where any element lacks it;
- `data: rows.map((r) => ({ ... }))` (concise or `return { ... }` body) without it.

```ts
// with { tenantModels: ['invoice'] }

// ✗
await this.prisma.unscoped.invoice.create({ data: { total } });
await this.prisma.unscoped.invoice.createMany({ data: rows.map((r) => ({ total: r.total })) });

// ✓
await this.prisma.unscoped.invoice.create({ data: { total, tenantId } });
await this.prisma.client.invoice.create({ data: { total } }); // the extension fills tenantId
```

The verifiability policy is deliberately the **inverse** of `tenant-scoped-tables-require-where`:
only a statically provable absence is reported. Anything the rule cannot read is allowed, never
flagged: an identifier as `data`, a spread inside `data` (it may supply the field), a `createMany`
element that is not an object literal, a `.map(buildRow)` callback it cannot see into, or no
argument at all.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tenantModels` | `string[]` | `[]` | Delegate accessors the tenant extension isolates. Nothing is guessed: with none, the rule reports nothing. |
| `tenantFields` | `string[]` (1+) | `['tenantId']` | Columns that must ALL be set in `data`. |
| `receiverPattern` | `string` (regex source) | `'prisma'` | A name matching this (case-insensitive) is a Prisma client, when resolving a local bound to the unscoped client. |
| `unscopedProperty` | `string` | `'unscoped'` | The member that exposes the unscoped client. |

## Limits

Name and shape matching with no type information, and it trusts spreads. A tenant column supplied
through `...dto` is taken on faith; `no-cross-tenant-id-in-where` is the rule that looks at where a
tenant id VALUE comes from.
