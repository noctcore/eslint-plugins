# @noctcore/lint-meta-rules

Portable, parameterized **lint-meta** rules — whole-repo / cross-file invariants that ESLint's
per-file AST model cannot reach (every `package.json` name matches a convention, every imported
workspace package is a declared dependency, file-size ratchets, agent-doc presence, and more).

Each rule implements the portable [`IMetaRule`](https://www.npmjs.com/package/@noctcore/harness)
contract published by `@noctcore/harness`: a pure function of an `IMetaCtx` returning `IViolation[]`.

## How this package is consumed

This is a **versioned source catalog**, not a runtime dependency you `require()` from a consumer's
registry. The `@noctcore/harness` `lint-meta` subcommand runs a *bounded eval* that executes only one
local `.nightcore/lint-meta/registry.js` and never resolves arbitrary imports — a deliberate security
boundary, since that file runs inside a foreign CI. So the intended integration point is nightcore's
harness **export pipeline**: it reads a rule's source here, inlines/transforms it, and emits flat
JavaScript directly into a consumer's `.nightcore/lint-meta/`. No consumer registry imports this
package at runtime.

Publishing to npm is for versioning and discoverability; it is not a "`npm install` this and
`require()` it" pitch.

## Why factories

`IMetaRule.run(ctx)` takes no config, so every rule that hardcoded a nightcore-specific anchor (a
`@nightcore` scope, an `apps/web/src` root, a rank table) is exported as a **factory** —
`createXRule(options): IMetaRule` — with those anchors lifted to typed options carrying sensible
defaults. A programmatic caller (or the export pipeline) constructs each rule with the consumer's own
options:

```ts
import { createPackageShapeRule, createFileSizeRatchetRule } from '@noctcore/lint-meta-rules';

const rules = [
  createPackageShapeRule({ scope: '@acme' }),
  createFileSizeRatchetRule({ id: 'web-file-size-ratchet', roots: ['apps/web/src'], cap: 400 }),
];
```

`RULE_FACTORIES` (an id → factory map), `RULE_IDS`, and `createAllRules()` are exported for iteration
over the whole catalog.

## Rules

13 nightcore lint-meta rules are ported as 12 factories — nightcore's `web-file-size-ratchet` and
`engine-file-size-ratchet` were byte-identical logic and collapse into a single
`createFileSizeRatchetRule` (instantiated once per capped area).

| Factory | Source rule(s) | Category | What it enforces |
| --- | --- | --- | --- |
| [`createNoWarnSeverityRule`](./docs/rules/no-warn-severity.md) | `no-warn-severity` | config | ESLint severity is `error`/`off`, never `warn`. |
| [`createPackageShapeRule`](./docs/rules/package-shape.md) | `package-shape` | config | Every workspace is named `<scope>/<dir>`; libraries expose a barrel and point build fields at `dist/`. |
| [`createWorkspaceGraphParityRule`](./docs/rules/workspace-graph-parity.md) | `workspace-graph-parity` | config | Imported `<scope>/*` specifiers are declared `workspace:*` deps and mirrored in tsconfig references. |
| [`createLayerRankRule`](./docs/rules/layer-rank.md) | `layer-rank` | source-text | A module imports only strictly-lower-ranked `<scope>` packages (no sideways/upward edges). |
| [`createFileSizeRatchetRule`](./docs/rules/file-size-ratchet.md) | `web-file-size-ratchet`, `engine-file-size-ratchet` | source-text | Source files stay under a line cap, with a one-way self-tightening baseline ratchet. |
| [`createAgentsDocPresenceRule`](./docs/rules/agents-doc-presence.md) | `agents-doc-presence` | source-text | An agent-contract doc exists at the root, every surface, and every non-opted-out package. |
| [`createTestSiblingEnforcementRule`](./docs/rules/test-sibling-enforcement.md) | `test-sibling-enforcement` | source-text | Every source file matched by `include` has a colocated sibling test. |
| [`createCanonicalHelpersSingleHomeRule`](./docs/rules/canonical-helpers-single-home.md) | `canonical-helpers-single-home` | source-text | A helper symbol is not exported from two different helper homes. |
| [`createNoClonedComponentFoldersRule`](./docs/rules/no-cloned-component-folders.md) | `no-cloned-component-folders` | source-text | A component folder name exists under only one feature (shrinking allowlist). |
| [`createUiPrimitiveShapeRule`](./docs/rules/ui-primitive-shape.md) | `ui-primitive-shape` | source-text | A folder primitive ships its proof siblings; a flat primitive carries none at the ui root. |
| [`createTestWorkspaceEnrollmentRule`](./docs/rules/test-workspace-enrollment.md) | `test-workspace-enrollment` | testing | Every tested package is enumerated in the aggregate test script. |
| [`createTestRunnerSegregationRule`](./docs/rules/test-runner-segregation.md) | `test-runner-segregation` | testing | Bun-side and foreign-side test runners are never mixed within a package. |

Every factory is callable with no arguments (all options default), so `createAllRules()` and
per-factory defaults work out of the box; supply options to retarget a rule at your own repo.
