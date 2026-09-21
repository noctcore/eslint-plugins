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

## Building blocks

The package also exports the pieces its rules are built on, so a project's own tooling reads the
same definitions instead of a copy that drifts: the Prisma method sets (`PRISMA_WRITE_METHODS`,
`PRISMA_DELEGATE_METHODS`, ...), a small schema reader (`parsePrismaSchema`, `loadPrismaSchema`,
`tenantBearingAccessors`) and `reconcileTenantRegistry`, which checks a tenant-scope registry
against the schema so a new tenant-bearing table cannot ship with no boundary.
