# `noctcore-prisma/no-unscoped-prisma-outside-allowlist`

> Keep the unscoped Prisma client, and any "run without tenant scope" helper, inside an allowlist of
> system files.

## Why

A multi-tenant Prisma app without row-level security usually isolates tenants with a client
extension that injects the tenant column into every query. That extension is the whole boundary.
Most such apps also keep a way around it: an unscoped client (`prisma.unscoped`) for seeds and
system jobs, and sometimes a helper that runs a callback outside the tenant context. Used from
ordinary request code, either one is a silent cross-tenant read or write that type-checks and passes
its tests.

## What it flags

Outside the files in `allowedFiles`:

- a `<receiver>.<unscopedProperty>` member access, where the receiver's name matches
  `receiverPattern` (`this.prisma.unscoped`, `prismaService.unscoped`);
- destructuring the unscoped client into a local binding (`const { unscoped } = this.prismaService`,
  `const { unscoped: raw } = ...`), which the member matcher would otherwise never see again;
- a direct call to any function named in `escapeHatchFns`.

```ts bad reports=3 filename=apps/api/src/invoices/invoice.service.ts options={"escapeHatchFns":["runWithoutTenantScope"]}
const rows = await this.prisma.unscoped.invoice.findMany();
const { unscoped } = this.prismaService;
await runWithoutTenantScope(() => sweep()); // with escapeHatchFns: ['runWithoutTenantScope']
```

```ts good filename=apps/api/src/invoices/invoice.service.ts options={"escapeHatchFns":["runWithoutTenantScope"]}
// the tenant-scoped client
const rows = await this.prisma.client.invoice.findMany();
```

```ts good filename=prisma/seed.ts options={"escapeHatchFns":["runWithoutTenantScope"]} relocation
// allowlisted by default
await prisma.unscoped.invoice.createMany({ data: fixtures });
```

The scoped client is never reported, and neither is a property named `unscoped` on a receiver that
does not match `receiverPattern` (`this.cache.unscoped()`).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowedFiles` | `string[]` (globs) | `['**/prisma/seed.ts', '**/*.seed.ts', '**/prisma/migrations/**', '**/*.isolation.spec.ts']` | Files allowed to use the unscoped client and the escape hatches. Replaces the default list. |
| `receiverPattern` | `string` (regex source) | `'prisma'` | An identifier or property name must match this (case-insensitive) to count as a Prisma client. |
| `unscopedProperty` | `string` | `'unscoped'` | The member that exposes the unscoped client. |
| `escapeHatchFns` | `string[]` | `[]` | Functions that run a callback outside the tenant scope. None by default: name yours. |

Each glob is matched against the file's absolute path and against its path relative to the
workspace root (the nearest ancestor holding a lockfile, `pnpm-workspace.yaml` or `.git`). So a
leading `**/` works from anywhere, and a root-anchored glob such as `packages/database/**` still
matches when a task runner lints one package at a time. Globs support `*`, `**`, `?` and `{a,b}`.

```js
'noctcore-prisma/no-unscoped-prisma-outside-allowlist': ['error', {
  allowedFiles: [
    '**/prisma/seed.ts',
    '**/prisma/migrations/**',
    '**/*.isolation.spec.ts',
    '**/common/database/prisma.service.ts',
    '**/common/tenancy/cross-tenant-iterator.ts',
  ],
  escapeHatchFns: ['runWithoutTenantScope'],
}]
```

Add specific paths, not a filename suffix: a `**/*.system.ts` opt-out lets any file rename itself
past the guard.

## Limits

Name and shape matching with no type information. It catches the direct member, the destructure and
the escape-hatch call, but not a client laundered through a function return (`getDb().invoice`).
Only RLS is a complete backstop.

## When not to use it

If your app has no tenant-scoping extension and no unscoped client, there is nothing to fence.
