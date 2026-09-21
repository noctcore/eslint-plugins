# `noctcore-prisma/no-cross-tenant-id-in-where`

> The tenant id in a Prisma `where` or `data` must come from server context, never from client input.

## Why

Without row-level security, the tenant id on a query is the cross-tenant boundary. A tenant id read
from the request (`input.tenantId`, `req.body.tenantId`) lets a caller read or write another tenant's
rows by sending a different id: an IDOR that type-checks, passes its tests and looks like ordinary
filtering in review.

## What it flags

A Prisma read or write (`findMany`, `create`, `updateMany`, ... every delegate method) on a model in
`tenantModels`, whose first argument's `where` or `data` object sets `tenantField` to a member chain
rooted at one of `untrustedRoots`.

```ts
// ✗
await this.prisma.invoice.findMany({ where: { tenantId: input.tenantId } });
await tx.invoice.update({ where: { tenantId: req.body.tenantId, id }, data });
await this.prisma.invoice.create({ data: { tenantId: dto.tenantId, total } });

// ✓ server context
await this.prisma.invoice.findMany({ where: { tenantId: ctx.tenantId } });
await this.prisma.invoice.findMany({ where: { tenantId: getTenantId() } });
```

The model accessor is the member before the method (`x.invoice.findMany`), or the bare receiver
(`invoice.findMany`).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tenantModels` | `string[]` | omitted: every model | Delegate accessors to police. A client-supplied tenant id is an IDOR whichever table it filters, so the default polices all of them; pass a list to narrow it. |
| `tenantField` | `string` | `'tenantId'` | The field carrying the tenant id. |
| `untrustedRoots` | `string[]` | `['input', 'dto', 'body', 'query', 'params', 'req']` | Root identifiers that hold client input. Replaces the default list. |

## Limits

Provenance is read from the value's own spelling, one member chain deep. A client id copied into a
local first (`const t = input.tenantId; ... { tenantId: t }`), passed through a function, or read
from a root not in `untrustedRoots` is not traced. Only the top level of `where` and `data` is
inspected, not `AND` / `OR` arms or nested relation filters.
