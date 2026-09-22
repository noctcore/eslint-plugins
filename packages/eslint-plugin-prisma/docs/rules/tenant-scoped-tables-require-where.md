# `noctcore-prisma/tenant-scoped-tables-require-where`

> A query on a tenant-scoped model through the unscoped client must filter by every tenant column,
> and a query on a hand-scoped model must filter by one of its scope columns on any client.

## Why

A tenant-scoping client extension injects `tenantId` into every query on the models it knows. The
unscoped client, kept for seeds and system jobs, injects nothing. A `findMany` through it that forgets
the tenant filter reads every tenant's rows, and it type-checks and passes its tests.

Some tenant-bearing models are deliberately left out of the extension (an audit log whose system
rows have no tenant, a notification scoped by user rather than by tenant). For those, "scoped by
hand" is otherwise a sentence in a comment. This rule makes it a check.

## What it flags

**Extension-scoped models** (`tenantModels`), on the unscoped client only:

- a filtered read (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`) or a
  filtered bulk write (`updateMany`, `updateManyAndReturn`, `deleteMany`)
- whose `where` is missing, not an object literal, or lacks any one of `tenantFields`.

The receiver counts as the unscoped client when its chain contains `.<unscopedProperty>`
(`this.prisma.unscoped.invoice`, `tx.unscoped.invoice`), or when its root is a local bound to the
unscoped client (`const db = this.prisma.unscoped`, `const { unscoped } = this.prismaService`).

`findUnique`, `findUniqueOrThrow`, `update`, `delete` and `upsert` are exempt: they take a unique
selector, not a scope filter.

**Hand-scoped models** (`handScopedModels`), on **every** receiver:

- any read, update or delete (including the unique-selector ones: `notification.findUnique({ where:
  { id } })` handed to a user is an IDOR)
- whose `where` mentions none of the model's listed scope columns anywhere in its tree. `AND`, `OR`
  and relation filters are walked, so `{ OR: [{ tenantId }, { user: { tenantId } }] }` counts.

```ts bad reports=2 options={"tenantModels":["invoice"],"handScopedModels":{"notification":["userId"]}}
// with { tenantModels: ['invoice'], handScopedModels: { notification: ['userId'] } }
await this.prisma.unscoped.invoice.findMany({ where: { status: 'OPEN' } });
await this.prisma.client.notification.findUnique({ where: { id } });
```

```ts good options={"tenantModels":["invoice"],"handScopedModels":{"notification":["userId"]}}
await this.prisma.unscoped.invoice.findMany({ where: { tenantId, status: 'OPEN' } });
await this.prisma.client.invoice.findMany({ where: { status: 'OPEN' } }); // the extension scopes it
await this.prisma.client.notification.findFirst({ where: { id, userId } });
```

A hand-scope clause lifted into a `const` is reported: the rule reads syntax, not bindings, on
purpose. The scope of a hand-scoped read is the one thing that must stay visible at the call site.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tenantModels` | `string[]` | `[]` | Delegate accessors the tenant extension isolates (`invoice`, not `Invoice`). Nothing is guessed: with none, only `handScopedModels` is checked. |
| `tenantFields` | `string[]` (1+) | `['tenantId']` | Columns that must ALL appear at the top level of the `where`. List two for a model scoped on two axes. |
| `handScopedModels` | `Record<string, string[]>` | `{}` | Model accessor -> scope columns, ANY ONE of which satisfies the check. Accepts `TenantRegistry['handScopedModels']` as-is. |
| `allowIn` | `string[]` (globs) | `[]` | Files not policed, e.g. a system sweep that reads every tenant on purpose. |
| `receiverPattern` | `string` (regex source) | `'prisma'` | A name matching this (case-insensitive) is a Prisma client, when resolving a local bound to the unscoped client. |
| `unscopedProperty` | `string` | `'unscoped'` | The member that exposes the unscoped client. |

Globs are matched against the file's absolute path and its workspace-root-relative path, like the
other rules in this plugin.

Keep `tenantModels` in step with the extension's model map mechanically. `reconcileTenantRegistry`
(exported from this package) checks the extension's map against the schema; a consumer test that
also compares the map to this option closes the loop.

## Limits

Name and shape matching with no type information. A `where` built by a function
(`findMany({ where: buildWhere() })`) is reported for a tenant model, because the rule cannot see the
tenant column in it; spell the tenant field inline. A client laundered through a function return
(`getDb().invoice`) is not followed. Only row-level security is a complete backstop.
