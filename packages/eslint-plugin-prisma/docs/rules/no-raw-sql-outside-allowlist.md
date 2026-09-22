# `noctcore-prisma/no-raw-sql-outside-allowlist`

> Keep raw SQL that can touch a table inside an allowlist, and never use the `*Unsafe` variants.

## Why

A tenant-scope client extension dispatches on the query's `model`. A raw query has no model, so it
passes through the extension unscoped: `$queryRaw` reading a tenant table returns every tenant's
rows. The extension cannot parse SQL, so this door can only be guarded statically.

## What it flags

- `$queryRaw` / `$executeRaw` as a **tagged template** whose literal text names a table-touching
  keyword (`FROM`, `INTO`, `UPDATE`, `JOIN`, ...). Interpolated values are bound parameters and are
  not read, so `${fromDate}` is not the keyword `FROM`. A `Prisma.raw` / `Prisma.sql` /
  `Prisma.join` fragment splices text the rule cannot see, so it is reported as unreadable.
- `$queryRaw` / `$executeRaw` in **call form**, `$queryRawTyped`, a bare reference
  (`const run = tx.$executeRaw`) and a destructure (`const { $queryRaw } = client`): the SQL text is
  not readable at the call site.
- `$queryRawUnsafe` / `$executeRawUnsafe` **everywhere, allowlist or not**: they take a string, so
  they are an injection sink as well as a tenant escape.

Allowlisted files skip everything except the `*Unsafe` report.

```ts bad reports=4
const rows = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "accountId" = ${accountId}`;
await tx.$queryRaw(Prisma.sql`SELECT 1`);
await tx.$queryRaw`SELECT ${Prisma.raw(columns)}`;
await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE id = ${id}`);
```

```ts good
// touches no table
await prisma.$queryRaw`SELECT 1`;
await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

// a model query through the scoped client
const rows = await prisma.invoice.findMany({ where: { accountId } });
```

`pg_advisory_xact_lock` does not match `LOCK`: keywords match as whole words, and `_` is a word
character.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowedFiles` | `string[]` (globs) | `['**/prisma/seed.ts', '**/*.seed.ts', '**/prisma/migrations/**', '**/*.isolation.spec.ts']` | Files allowed to run any raw SQL except the `*Unsafe` variants. Replaces the default list. |
| `tableKeywords` | `string[]` | `['FROM', 'INTO', 'UPDATE', 'JOIN', 'TABLE', 'DELETE', 'MERGE', 'COPY', 'TRUNCATE', 'LOCK', 'ALTER', 'DROP']` | Whole-word, case-insensitive keywords that mark a literal chunk as table-touching. |

Globs match the absolute path and the workspace-root-relative path, as described in
[`no-unscoped-prisma-outside-allowlist`](./no-unscoped-prisma-outside-allowlist.md#options).

The rule keys on Prisma's `$`-prefixed raw method names rather than on the receiver, so it takes no
receiver options.

## Limits

The carve-out is a floor, not a proof: a tableless statement can still call a SQL function that
reads a table. That is a reviewed-code problem; the rule exists so the obvious
`SELECT ... FROM "Invoice"` cannot land silently.

## When not to use it

If your app is single-tenant and raw SQL is reviewed by other means, the `*Unsafe` half is still
worth keeping; consider enabling the rule with a wide `allowedFiles` instead of turning it off.
