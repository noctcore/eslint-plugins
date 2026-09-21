# @noctcore/eslint-plugin-prisma

Prisma tenancy and transaction guardrails: fence the escape hatches around a tenant-scoping client
extension, and keep multi-write code transactional. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-prisma   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import prisma from '@noctcore/eslint-plugin-prisma';

export default [
  prisma.configs.recommended,
];
```

Or wire rules individually, with your project's conventions:

```js
import prisma from '@noctcore/eslint-plugin-prisma';

export default [
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts'],
    plugins: { 'noctcore-prisma': prisma },
    rules: {
      'noctcore-prisma/no-unscoped-prisma-outside-allowlist': ['error', {
        allowedFiles: ['**/prisma/seed.ts', '**/prisma/migrations/**', '**/common/database/prisma.service.ts'],
        escapeHatchFns: ['runWithoutTenantScope'],
      }],
      'noctcore-prisma/no-raw-sql-outside-allowlist': 'error',
      'noctcore-prisma/prisma-write-in-transaction': ['error', { clientProperties: ['client'] }],
      'noctcore-prisma/prisma-tx-uses-tx-not-client': ['error', { clientProperties: ['client'] }],
    },
  },
];
```

No project convention is hardcoded. What a Prisma receiver is called (`receiverPattern`), the
unscoped client's property (`unscopedProperty`), escape-hatch functions (`escapeHatchFns`), extra
client properties (`clientProperties`) and transaction-client names (`txRootNames`) are all options
with defaults that fit a conventional Prisma codebase. The rules are name- and shape-based and need
no type information.

## Rules

| Rule | Description |
| --- | --- |
| [`no-audit-write-in-transaction`](./docs/rules/no-audit-write-in-transaction.md) | No audit-log write inside a `$transaction` callback. Does not check that mutations are audited. |
| [`no-cross-tenant-id-in-where`](./docs/rules/no-cross-tenant-id-in-where.md) | A tenant id in `where` / `data` comes from server context, never from client input. |
| [`no-raw-sql-outside-allowlist`](./docs/rules/no-raw-sql-outside-allowlist.md) | Raw SQL that can touch a table only in allowlisted files; `*Unsafe` never. |
| [`no-unscoped-prisma-outside-allowlist`](./docs/rules/no-unscoped-prisma-outside-allowlist.md) | The unscoped client and tenant-scope escape hatches only in allowlisted files. |
| [`prisma-tx-uses-tx-not-client`](./docs/rules/prisma-tx-uses-tx-not-client.md) | Inside an interactive `$transaction`, writes go through `tx`, not the outer client. |
| [`prisma-write-in-transaction`](./docs/rules/prisma-write-in-transaction.md) | Two or more writes in one function must be wrapped in a `$transaction`. |
| [`restrict-model-writes`](./docs/rules/restrict-model-writes.md) | Only a model's owning files may write it (or its fenced columns), nested writes included. Does not check transitions. |
| [`soft-deletable-tables-require-deleted-at`](./docs/rules/soft-deletable-tables-require-deleted-at.md) | Filtered reads and bulk writes on soft-deletable models exclude deleted rows. |
| [`tenant-scoped-tables-require-where`](./docs/rules/tenant-scoped-tables-require-where.md) | Unscoped-client queries on tenant models filter by every tenant column; hand-scoped models filter by a scope column on any client. |
| [`tenant-write-must-carry-tenant-id`](./docs/rules/tenant-write-must-carry-tenant-id.md) | Unscoped-client creates on tenant models set every tenant column in `data`. |

## Building blocks

The package also exports the pieces its rules are built on, so a project's own tooling reads the
same definitions instead of a copy that drifts: the Prisma method sets (`PRISMA_WRITE_METHODS`,
`PRISMA_DELEGATE_METHODS`, ...), a small schema reader (`parsePrismaSchema`, `loadPrismaSchema`,
`tenantBearingAccessors`) and `reconcileTenantRegistry`, which checks a tenant-scope registry
against the schema so a new tenant-bearing table cannot ship with no boundary.
