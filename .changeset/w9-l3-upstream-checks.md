---
'@noctcore/lint-meta-rules': minor
---

Add three stronger config checks on two new entry points, each parameterised for any project.

- `@noctcore/lint-meta-rules/resolved-config`: `createEslintConfigNoWarnRule` resolves each package's effective ESLint config with `calculateConfigForFile` and reports any rule that resolves to `warn`, including a severity a spread preset injects, which the text scan of `no-warn-severity` cannot see. It fails closed on a config that cannot be resolved, including one that breaks for a single file shape.
- `@noctcore/lint-meta-rules/prisma`: `createTenantModelRegistryParityRule` derives the tenant-bearing models from the Prisma schema and asserts the runtime scope map, the injected exemption registry and the tenant rules' resolved `tenantModels` / `handScopedModels` options all agree, so a new tenant-scoped model cannot ship without the guardrails learning about it. `createPrismaMethodSurfaceRule` asserts the Prisma reads and writes the rules police are exactly the generated client's `<Model>Delegate` methods, so a Prisma upgrade cannot add an unguarded method.

The resolved-config checks are async and need `@noctcore/harness` 0.3.0 (`runAsync`) and the optional `eslint` peer. The package now depends on `@noctcore/eslint-plugin-prisma` for the shared method sets, schema parser and registry reconciliation.
