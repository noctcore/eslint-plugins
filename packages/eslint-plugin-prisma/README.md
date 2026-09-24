# @noctcore/eslint-plugin-prisma

**Docs:** [noctcore.github.io/eslint-plugins/packages/prisma](https://noctcore.github.io/eslint-plugins/packages/prisma/)

Prisma tenancy, data-integrity and transaction guardrails: fence the escape hatches around a
tenant-scoping client extension, keep tenant and soft-delete filters on the queries that need them,
fence single-writer models to their owners, and keep multi-write code transactional. Flat-config
only, ESLint 9+.

## Requirements

- ESLint 9 or newer, flat config (`eslint.config.js`) only.
- `configs.recommended` registers the plugin and sets rule severities, nothing else. It sets no
  `files` and no parser, so it applies to whatever files the rest of your config lints. To lint
  TypeScript, add a `files` pattern and `@typescript-eslint/parser`:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import prisma from '@noctcore/eslint-plugin-prisma';

export default [
  {
    ...prisma.configs.recommended,
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
];
```

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
      'noctcore-prisma/no-cross-tenant-id-in-where': 'error',
      'noctcore-prisma/no-request-body-in-write': 'error',
      'noctcore-prisma/no-audit-write-in-transaction': 'error',

      // Needs type information: see its docs.
      'noctcore-prisma/mutation-entry-must-reach-audit': ['error', { unauditedModels: ['tourProgress'] }],

      // These need your registry and report nothing without it.
      'noctcore-prisma/tenant-scoped-tables-require-where': ['error', {
        tenantModels: ['invoice', 'customer'],
        handScopedModels: { notification: ['userId'] },
      }],
      'noctcore-prisma/tenant-write-must-carry-tenant-id': ['error', { tenantModels: ['invoice', 'customer'] }],
      'noctcore-prisma/soft-deletable-tables-require-deleted-at': ['error', {
        softDeleteModels: ['user'],
        softDeleteSpreads: ['notDeleted'],
      }],
      'noctcore-prisma/restrict-model-writes': ['error', {
        restrictions: [
          { models: ['payment'], allowedFiles: ['**/billing/payment.service.ts'], owner: 'PaymentService' },
          {
            models: ['invoice'],
            fields: ['status'],
            allowedFiles: ['**/billing/invoice-lifecycle.service.ts'],
            owner: 'InvoiceLifecycleService',
          },
        ],
      }],
    },
  },
];
```

`recommended` turns on the seven rules whose defaults hold with no project knowledge. Four more
need your model registry (`tenantModels`, `softDeleteModels`, `restrictions`) and are left out of the
preset on purpose: an entry that reports nothing would read as coverage you do not have. The last one,
`mutation-entry-must-reach-audit`, needs type information.

No project convention is hardcoded. What a Prisma receiver is called (`receiverPattern`), the
unscoped client's property (`unscopedProperty`), escape-hatch functions (`escapeHatchFns`), extra
client properties (`clientProperties`) and transaction-client names (`txRootNames`) are all options
with defaults that fit a conventional Prisma codebase. Which models are tenant-scoped,
soft-deletable or single-writer is never guessed: those lists default to empty. The rules are name-
and shape-based and need no type information, with one exception: `mutation-entry-must-reach-audit`
follows calls across files through the type checker, refuses to run without it, and is not in
`recommended` for that reason.

Three rules state a limit loudly, because their names could be read as promising more:
`restrict-model-writes` fences WHO writes a model, and does not validate state transitions;
`no-audit-write-in-transaction` polices WHERE an audit write sits, and does not check that mutations
are audited. `mutation-entry-must-reach-audit` is the rule that checks audits exist, and it states its
own limit in its name: it proves an audit is reachable from each mutation entry point, not that every
mutating method audits.

## Rules

| Rule | Description |
| --- | --- |
| [`mutation-entry-must-reach-audit`](./docs/rules/mutation-entry-must-reach-audit.md) | A `@Mutation()` entry that can reach a Prisma write must be able to reach an audit write, across files. Needs type information. |
| [`no-audit-write-in-transaction`](./docs/rules/no-audit-write-in-transaction.md) | No audit-log write inside a `$transaction` callback. Does not check that mutations are audited. |
| [`no-cross-tenant-id-in-where`](./docs/rules/no-cross-tenant-id-in-where.md) | A tenant id in `where` / `data` comes from server context, never from client input. |
| [`no-raw-sql-outside-allowlist`](./docs/rules/no-raw-sql-outside-allowlist.md) | Raw SQL that can touch a table only in allowlisted files; `*Unsafe` never. |
| [`no-request-body-in-write`](./docs/rules/no-request-body-in-write.md) | A write's `data` or `where` is never the raw request body (mass assignment, filter injection). |
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
