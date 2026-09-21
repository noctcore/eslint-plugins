# `tenant-model-registry-parity`

> Every tenant-bearing Prisma model is scoped by the runtime tenant extension or exempt with a
> reason, and the tenant lint rules resolve with exactly that registry.

Import it from the `prisma` entry point:

```ts
import { createTenantModelRegistryParityRule } from '@noctcore/lint-meta-rules/prisma';
```

## Why

A multi-tenant Prisma project keeps "which models are tenant-scoped?" in two hand-maintained places:
the model map of its tenant-scope client extension (the runtime boundary) and the model list its
tenant lint rules are configured with (the static boundary). Checking those two against each other
catches a list edited on one side. It cannot catch the expensive case: a migration adds a
tenant-bearing table and touches neither list, so the table gets no runtime scope and no lint
coverage while both lists still agree.

So the SCHEMA is the third input. The set of tenant-bearing models is derived from it, and every one
must be in the runtime map or in an explicit `unscopedByDesign` exemption with a written reason. A
new tenant-scoped model cannot be added without the guardrails learning about it.

The static side is read from the RESOLVED ESLint config, not by parsing the config file, so it
asserts what the rules actually receive: moving the array, spreading a different preset, or passing
one rule a hand-written list is all caught.

## What it flags

1. **Schema vs registry** (via `reconcileTenantRegistry` from `@noctcore/eslint-plugin-prisma`): a
   model carrying every `tenantFields` column that is neither scoped nor exempt; a model both scoped
   and exempt; a scoped model or exemption no schema model maps to.
2. **Hand scope** (when `requireHandScope`): an exemption with no `handScopedModels` columns and no
   `handScopePending` note; a `handScopedModels` or `handScopePending` entry for a model that is not
   exempt.
3. **Registry vs resolved config** (unless `eslint: false`): for each of `modelRules`, a rule that is
   off or not configured, a rule with no `modelsOption`, a scoped model missing from the option, or
   an option model that is not scoped; and a `handScopedRule` whose `handScopedOption` does not equal
   `registry.handScopedModels`.

It **fails closed**: an unreadable runtime map, a missing schema, or a config that cannot be
resolved is a violation, never an empty registry. Schema findings are still reported when the config
cannot be resolved.

Async: it implements the harness's `runAsync` (`@noctcore/harness` 0.3.0 or newer).

## Factory

```ts
createTenantModelRegistryParityRule(options?: TenantModelRegistryParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'tenant-model-registry-parity'` | Rule id. |
| `schemaPath` | `string` | `'prisma/schema.prisma'` | The schema: a `.prisma` file, or a folder whose `.prisma` files (recursively) are read together. |
| `tenantFields` | `string[]` | `['tenantId']` | Columns that make a model tenant-bearing; a model must carry ALL of them. |
| `registry` | `TenantRegistry` | `{ scopedModels: [], unscopedByDesign: {} }` | The project's registry as injected DATA: `scopedModels`, `unscopedByDesign`, `handScopedModels`, `handScopePending` (the `TenantRegistry` type from `@noctcore/eslint-plugin-prisma`). |
| `scopedModelsSource` | `{ file, exportName }` | none | Read the scoped models from the runtime source instead of `registry.scopedModels`: the top-level keys of the object literal assigned to `exportName` in `file`. |
| `requireHandScope` | `boolean` | `true` | Require every exemption to name its hand-scope columns or record why it cannot. |
| `eslint` | `TenantRegistryEslintOptions \| false` | `{}` | The static side (below), or `false` to check only the registry against the schema. |
| `registryFile` | `string` | `scopedModelsSource.file`, else `schemaPath` | Path reported for registry-side violations. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

`eslint` options:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cwd` | `string` | `'.'` | Directory whose ESLint config is resolved. |
| `probe` | `string` | `'src/__lint_meta_probe__.ts'` | File, relative to `cwd`, the config is resolved for. Match the glob your tenant rules are scoped to. |
| `modelRules` | `string[]` | the `noctcore-prisma` rules `no-cross-tenant-id-in-where`, `tenant-scoped-tables-require-where`, `tenant-write-must-carry-tenant-id` | Rules whose model option must equal the scoped models. |
| `modelsOption` | `string` | `'tenantModels'` | The option those rules take the model list in. |
| `handScopedRule` | `string \| null` | `'noctcore-prisma/tenant-scoped-tables-require-where'` | The rule whose hand-scope option must equal `registry.handScopedModels`; `null` skips it. Checked only when the registry has hand-scoped models. |
| `handScopedOption` | `string` | `'handScopedModels'` | The option that rule takes the map in. |
| `configFile` | `string` | `cwd` | Path reported for config-side violations: where a maintainer edits the list. |

Keys are Prisma delegate accessors (`invoice` for `model Invoice`).

## Worked example: Settly

Settly scopes on `tenantId`, splits its schema per domain, keeps the runtime map in its API's tenant
extension and the exemption maps in a registry module its ESLint config also reads:

```ts
import { createTenantModelRegistryParityRule } from '@noctcore/lint-meta-rules/prisma';

import { HAND_SCOPED_MODELS, HAND_SCOPE_PENDING, UNSCOPED_BY_DESIGN } from './tenant-registry';

createTenantModelRegistryParityRule({
  schemaPath: 'packages/database/prisma/schema',
  tenantFields: ['tenantId'],
  scopedModelsSource: {
    file: 'apps/api/src/common/database/tenant-scope.extension.ts',
    exportName: 'TENANT_SCOPED_MODELS',
  },
  registry: {
    scopedModels: [],
    unscopedByDesign: UNSCOPED_BY_DESIGN,
    handScopedModels: HAND_SCOPED_MODELS,
    handScopePending: HAND_SCOPE_PENDING,
  },
  eslint: {
    cwd: 'apps/api',
    probe: 'src/modules/example/example.service.ts',
    configFile: 'packages/eslint-config/nestjs.js',
  },
});
```

The registry is data the lint-meta registry imports from wherever the project keeps it; the rule
never reads a project file by a hardcoded path.

## When not to use it

A project with row-level security as its tenant boundary, or with no client-side scope map, has no
runtime registry to reconcile: use `eslint: false` and the schema half alone, or skip the rule.
