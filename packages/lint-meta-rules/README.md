# @noctcore/lint-meta-rules

**Docs:** [noctcore.github.io/eslint-plugins/packages/lint-meta-rules](https://noctcore.github.io/eslint-plugins/packages/lint-meta-rules/)

Whole-repo checks that ESLint's one-file-at-a-time model cannot make: every workspace is named by
convention, every imported workspace package is a declared dependency, every GitHub Action is pinned
to a commit SHA, no ESLint rule resolves to `warn`, no source file grows past a line cap, and more.
This is not an ESLint plugin; the rules run under the
[`@noctcore/harness`](https://www.npmjs.com/package/@noctcore/harness) `lint-meta` runner.

## What it checks

- **config**: workspace package names and build fields, the workspace dependency graph against
  imports and tsconfig references, ESLint severities.
- **source-text**: layering between packages, a file-size ratchet, agent-doc presence, colocated
  tests, one home per helper, no cloned component folders, UI primitive shape.
- **testing**: every tested package is enrolled in the aggregate test script, and test runners are
  not mixed within a package.
- **ci**: GitHub Actions pinned by SHA and to named runners, no template injection, least-privilege
  permissions, container images pinned by digest, and the secret scanner pinned to one version.

Every check is listed in [Rules](#rules), with a page per rule.

## How to run it

Each rule implements the [`IMetaRule`](https://www.npmjs.com/package/@noctcore/harness) contract
from `@noctcore/harness`: a pure function of an `IMetaCtx` returning `IViolation[]`. The harness
`lint-meta` subcommand runs them.

You do not `require()` this package from your repo. The harness executes only one local file,
`.nightcore/lint-meta/registry.js`, and never resolves arbitrary imports, because that file runs
inside CI. Its **export pipeline** reads a rule's source from this package, inlines it and writes
plain JavaScript into your repo's `.nightcore/lint-meta/`. The package is on npm for versioning and
discoverability.

### Every rule is a factory

`IMetaRule.run(ctx)` takes no config, so each rule is exported as a **factory**,
`createXRule(options): IMetaRule`. Anything project-specific (a workspace scope, a source root, a
rank table) is a typed option with a default. Some defaults, such as the `@nightcore` scope and the
400-line cap, are only starting points: set your own. A programmatic caller (or the export pipeline)
constructs each rule with your options:

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

The main entry exports 19 factories. `createFileSizeRatchetRule` covers any number of capped areas:
create one instance per area, each with its own `id`.

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
| [`createGithubActionsShaPinnedRule`](./docs/rules/github-actions-sha-pinned.md) | `github-actions-sha-pinned` | ci | Workflow `uses:` refs are pinned to a full commit SHA with a `# vN` comment. |
| [`createGithubActionsRunnerPinnedRule`](./docs/rules/github-actions-runner-pinned.md) | `github-actions-runner-pinned` | ci | Workflow jobs run on a named runner image, never a `*-latest` label. |
| [`createGithubActionsNoTemplateInjectionRule`](./docs/rules/github-actions-no-template-injection.md) | `github-actions-no-template-injection` | ci | `run:` and github-script bodies never expand attacker-controllable `${{ }}` context (issue/PR titles, comments, branch names). |
| [`createGithubActionsLeastPrivilegePermissionsRule`](./docs/rules/github-actions-least-privilege-permissions.md) | `github-actions-least-privilege-permissions` | ci | A workflow's top-level `permissions:` exists, is not `write-all`/`read-all`, and grants no write. |
| [`createServiceImageDigestPinRule`](./docs/rules/service-image-digest-pin.md) | `service-image-digest-pin` | ci | Workflow service/container images and compose images are pinned by `@sha256:` digest. |
| [`createDockerfileBaseImageDigestPinRule`](./docs/rules/dockerfile-base-image-digest-pin.md) | `dockerfile-base-image-digest-pin` | ci | Dockerfile `FROM` base images are pinned by `@sha256:` digest. |
| [`createSecurityScannerVersionParityRule`](./docs/rules/security-scanner-version-parity.md) | `security-scanner-version-parity` | ci | CI and the local pre-push hook pin the same secret-scanner version, and the hook checks it at run time. |

Every factory is callable with no arguments (all options default), so `createAllRules()` and
per-factory defaults work out of the box; supply options to retarget a rule at your own repo.

### `@noctcore/lint-meta-rules/i18n`

Whole-program translation checks live on a separate entry point, because they run ESLint's parser
and scope analysis (reusing the i18n visitor behind `noctcore-contracts/translation-key-exists`).
The main entry never loads ESLint; this one needs the optional peers `eslint` and
`@typescript-eslint/parser`. Its factories are not part of `RULE_FACTORIES` / `createAllRules()`:
they are inert until you point them at your catalogs.

| Factory | Category | What it enforces |
| --- | --- | --- |
| [`createTranslationDeadKeysRule`](./docs/rules/translation-dead-keys.md) | source-text | Every catalog key is reachable: named by a translation call, or spelled by some string in the source. |

### `@noctcore/lint-meta-rules/resolved-config`

Checks over the RESOLVED ESLint config. They load ESLint and resolve configs through
`calculateConfigForFile`, which is async, so they implement the harness's `runAsync`
(`@noctcore/harness` 0.3.0 or newer) and need the optional peer `eslint`.

| Factory | Category | What it enforces |
| --- | --- | --- |
| [`createEslintConfigNoWarnRule`](./docs/rules/eslint-config-no-warn.md) | config | No rule RESOLVES to `warn`, including a severity a spread preset injects, which the text scan of `no-warn-severity` cannot see. |

### `@noctcore/lint-meta-rules/prisma`

Whole-repo Prisma guardrails that keep `@noctcore/eslint-plugin-prisma`'s inputs honest. They read
the plugin's method sets, schema parser and registry reconciliation, so the lint rules and these
checks cannot disagree. The registry parity check resolves an ESLint config (async, `runAsync`) and
needs the optional peer `eslint`. Neither is in `RULE_FACTORIES`: both need the project's paths.

| Factory | Category | What it enforces |
| --- | --- | --- |
| [`createTenantModelRegistryParityRule`](./docs/rules/tenant-model-registry-parity.md) | config | Every tenant-bearing schema model is scoped at runtime or exempt with a reason, and the tenant lint rules resolve with exactly that registry. |
| [`createPrismaMethodSurfaceRule`](./docs/rules/prisma-method-surface.md) | config | The reads and writes the rules police are exactly the generated client's delegate methods, so a Prisma upgrade cannot add an unguarded one. |

### `@noctcore/lint-meta-rules/session`

Fences around the one seam that turns an authenticated principal into a session. Each rule is inert
until you name that seam: the method that mints, the gate in front of it, the files allowed to call it,
the landings a sign-in can end in. None is in `RULE_FACTORIES`. They load nothing beyond the harness
contract. Ported from a production NestJS app, where each one exists because its bug shipped once.

| Factory | Category | What it enforces |
| --- | --- | --- |
| [`createSessionMintCallersRule`](./docs/rules/session-mint-callers.md) | source-text | The method that mints a session is called only from allowlisted files, so a new sign-in entry point cannot skip the gate in front of it. |
| [`createSessionKindStampedRule`](./docs/rules/session-kind-stamped.md) | source-text | Every mint stamps the principal kind onto the session, or sits in an allowlisted, provably single-kind flow. |
| [`createSessionEpochCapturedRule`](./docs/rules/session-epoch-captured.md) | source-text | Every call into the sign-in seam passes the revocation epoch captured before the credential was read. |
| [`createSessionLandingDeclaredRule`](./docs/rules/session-landing-declared.md) | source-text | Every file that opens a door into a session declares its landing, and a door whose landing demands a return shape has it. |

### `@noctcore/lint-meta-rules/trpc`

Cross-tree checks between tRPC routers and the clients that call them. The decorator shape defaults to
`nestjs-trpc`'s; the rule is inert until you name the middleware and the two trees. Not in
`RULE_FACTORIES`.

| Factory | Category | What it enforces |
| --- | --- | --- |
| [`createIdempotencyKeyParityRule`](./docs/rules/idempotency-key-parity.md) | source-text | A procedure guarded by an idempotency middleware has a client caller that sends the key, or no client caller at all. |
