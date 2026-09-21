---
'@noctcore/eslint-plugin-prisma': minor
---

Six more rules, moved from a consumer's workspace-local plugin and generalized so no project convention or domain name is hardcoded.

- `tenant-scoped-tables-require-where`: unscoped-client reads and bulk writes on tenant models filter by every tenant column; hand-scoped models (`handScopedModels`, the shape of `TenantRegistry['handScopedModels']`) filter by one of their scope columns on any client.
- `tenant-write-must-carry-tenant-id`: unscoped-client creates on tenant models set every tenant column in `data`.
- `no-cross-tenant-id-in-where`: a tenant id in `where` / `data` is never read from a client-input root. Polices every model unless `tenantModels` narrows it. In `recommended`.
- `soft-deletable-tables-require-deleted-at`: filtered reads and bulk writes on soft-deletable models exclude deleted rows, recognising configured helper spreads.
- `restrict-model-writes`: one configurable single-writer fence replacing three per-domain rules. Each restriction names its models, the files allowed to write them and optionally the columns it is scoped to; nested relation writes are derived from the Prisma schema. It fences who writes and does NOT validate state transitions.
- `no-audit-write-in-transaction`: no audit-log write inside a `$transaction` callback. Moved from a rule named `mutating-service-must-audit` and renamed for what it does: it does NOT check that mutations are audited. In `recommended`.

The tenant, soft-delete and write-fence rules take the project's model lists as options that default to empty, and are left out of `recommended`. Also exports the `ModelWriteRestriction` type.
