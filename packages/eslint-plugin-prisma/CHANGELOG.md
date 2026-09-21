# @noctcore/eslint-plugin-prisma

## 0.2.0

### Minor Changes

- [`9da6b66`](https://github.com/noctcore/eslint-plugins/commit/9da6b66d6c1089916fa7d2c257321bd82ccb916e) Thanks [@Shironex](https://github.com/Shironex)! - Six more rules, moved from a consumer's workspace-local plugin and generalized so no project convention or domain name is hardcoded.

  - `tenant-scoped-tables-require-where`: unscoped-client reads and bulk writes on tenant models filter by every tenant column; hand-scoped models (`handScopedModels`, the shape of `TenantRegistry['handScopedModels']`) filter by one of their scope columns on any client.
  - `tenant-write-must-carry-tenant-id`: unscoped-client creates on tenant models set every tenant column in `data`.
  - `no-cross-tenant-id-in-where`: a tenant id in `where` / `data` is never read from a client-input root. Polices every model unless `tenantModels` narrows it. In `recommended`.
  - `soft-deletable-tables-require-deleted-at`: filtered reads and bulk writes on soft-deletable models exclude deleted rows, recognising configured helper spreads.
  - `restrict-model-writes`: one configurable single-writer fence replacing three per-domain rules. Each restriction names its models, the files allowed to write them and optionally the columns it is scoped to; nested relation writes are derived from the Prisma schema. It fences who writes and does NOT validate state transitions.
  - `no-audit-write-in-transaction`: no audit-log write inside a `$transaction` callback. Moved from a rule named `mutating-service-must-audit` and renamed for what it does: it does NOT check that mutations are audited. In `recommended`.

  The tenant, soft-delete and write-fence rules take the project's model lists as options that default to empty, and are left out of `recommended`. Also exports the `ModelWriteRestriction` type.

## 0.1.0

### Minor Changes

- [`b0c2bf9`](https://github.com/noctcore/eslint-plugins/commit/b0c2bf9184440275f4c4c29e0af7fa000a3267b1) Thanks [@Shironex](https://github.com/Shironex)! - New package: Prisma tenancy and transaction guardrails, moved from a consumer's workspace-local plugin so projects inherit them by installing a package instead of copying rules. Four rules, all in `recommended`: `no-unscoped-prisma-outside-allowlist`, `no-raw-sql-outside-allowlist`, `prisma-write-in-transaction` and `prisma-tx-uses-tx-not-client`.

  No project convention is hardcoded. The Prisma receiver name (`receiverPattern`, default `prisma`), the unscoped client's property (`unscopedProperty`, default `unscoped`), escape-hatch functions (`escapeHatchFns`, default none), extra client properties such as a repository's `this.client` (`clientProperties`, default none) and transaction-client names (`txRootNames`, default `tx`) are all documented options. Allowlist globs match both the absolute path and the workspace-root-relative path, with no glob dependency.

  Also exports the shared building blocks: the Prisma method sets, a small schema reader and `reconcileTenantRegistry`.
