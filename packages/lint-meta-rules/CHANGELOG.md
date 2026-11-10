# @noctcore/lint-meta-rules

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#172](https://github.com/noctcore/eslint-plugins/pull/172) [`b8ae43d`](https://github.com/noctcore/eslint-plugins/commit/b8ae43d4b19c8be34e3295aba3aaadbc1cf6e419) Thanks [@Shironex](https://github.com/Shironex)! - Six repo-hygiene rules:
  
  - `github-actions-timeout-required`: every workflow job that runs steps declares a job-level `timeout-minutes` (reusable-workflow calls are exempt).
  - `eslint-override-paths-exist`: literal `files` and one-file `ignores` paths in an ESLint flat config, and the directory each `files` glob starts in, exist relative to that config.
  - `tsconfig-include-paths-exist`: literal `include` and `files` entries in a tsconfig, and the directory each glob entry starts in, exist relative to that config.
  - On the new `@noctcore/lint-meta-rules/typescript` entry point (optional peer `typescript`):
    - `no-inline-lint-disable`: no inline `eslint-disable` directive in hand-written source, read through the TypeScript parser so strings, templates, regex literals and JSX text are never mistaken for comments; generated files are skipped, and `allowWithDescription` lets a reasoned directive through.
    - `no-ts-ignore`: no `@ts-ignore` (and, unless `allowExpectError`, no `@ts-expect-error`) in any comment form tsc honours.
    - `test-file-matches-runner-include`: every test file is collected by a Vitest, Jest, Bun or Playwright runner that covers its directory; configs the rule cannot read are left alone.

- [#168](https://github.com/noctcore/eslint-plugins/pull/168) [`5b125be`](https://github.com/noctcore/eslint-plugins/commit/5b125be217976993caed9c70b56d1cf089fafaa1) Thanks [@Shironex](https://github.com/Shironex)! - Five supply-chain rules:
  
  - `noctcore-packages-current`: every installed `@noctcore/*` package (or another `scope`) is inside its declared range, so a caret on 0.x cannot hide a published minor. Offline by default; `checkRegistry: true` also compares each range with the registry's latest version, skipping an unreachable registry and ignoring a stale read right after a publish.
  - `pnpm-hardening-settings`: `pnpm-workspace.yaml` keeps `strictDepBuilds`, `blockExoticSubdeps`, `engineStrict`, `trustPolicy: no-downgrade` and a minimum release age on, every `trustPolicyExclude` entry is exact and reasoned, and nothing overrides them in `.npmrc`, `package.json` or on a command line.
  - `node-version-parity`: `.nvmrc`, the root `engines.node`, every `actions/setup-node` step and every Docker node base image agree on the Node major.
  - `banned-dependencies`: no workspace manifest declares a package you named, with your reason in the message.
  - `pnpm-override-ledger`: every pnpm override has a dated, reasoned ledger entry, a security pin targets its own first patched version, and the lockfile honours the override.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`f66255f`](https://github.com/noctcore/eslint-plugins/commit/f66255f2c2b3b6de295a9159f9ec59bc345d49e3), [`14ba71c`](https://github.com/noctcore/eslint-plugins/commit/14ba71c5a23115e235edd441510ae7707e2aa9c5), [`e7d112d`](https://github.com/noctcore/eslint-plugins/commit/e7d112dedf552391ef20a267c52f7a4b02614baa), [`76b921c`](https://github.com/noctcore/eslint-plugins/commit/76b921c3796e7bf970447a4c2fcc6453a1418b38), [`fd98467`](https://github.com/noctcore/eslint-plugins/commit/fd98467ff4bb46d7cefc8d7619cc44a1d2b0edd3), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`d5db997`](https://github.com/noctcore/eslint-plugins/commit/d5db99734ce3749efe6b7e1eebe1b342e45892d9), [`3326a8d`](https://github.com/noctcore/eslint-plugins/commit/3326a8da6abc3efb0a60ec9fe59e4cd5d04c245d), [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e), [`65a5d38`](https://github.com/noctcore/eslint-plugins/commit/65a5d38d04029b10c464ec9c64cc4e13f52147f9), [`228e15e`](https://github.com/noctcore/eslint-plugins/commit/228e15ee0a74362572dc53c847609734c479abd7), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d), [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d)]:
  - @noctcore/eslint-plugin-contracts@1.0.0
  - @noctcore/eslint-plugin-prisma@1.0.0

## 0.6.2

### Patch Changes

- [#49](https://github.com/noctcore/eslint-plugins/pull/49) [`91a8a6e`](https://github.com/noctcore/eslint-plugins/commit/91a8a6e9f1108f6459307c92058540cf38285691) Thanks [@Shironex](https://github.com/Shironex)! - `ui-primitive-shape` now treats its `extension` and `barrelFile` options as literal text instead of regex source, so an extension like `.c++` no longer throws and `index.ts` no longer matches `indexxts`. `prisma-method-surface`, `tenant-model-registry-parity` and `eslint-config-no-warn` strip comments and trailing slashes in linear time, so a generated client with an unclosed `/*` can no longer stall the scan.

## 0.6.1

### Patch Changes

- [#44](https://github.com/noctcore/eslint-plugins/pull/44) [`da6ce97`](https://github.com/noctcore/eslint-plugins/commit/da6ce97dbfa4eb3a3bb39444929276661d8857b7) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README now follows the same layout in every
  package: requirements, install, a quick start with `files` and the TypeScript parser, one config
  block for every opt-in rule, the rules table and the severity policy. Every rule doc now has the same
  sections in the same order: why, what it flags, what it does not flag, options, when not to use it.

- [#40](https://github.com/noctcore/eslint-plugins/pull/40) [`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. Each package's npm page now links to its page on the
  docs site (`homepage` and a **Docs** link at the top of the README), and every plugin README states
  its requirements: ESLint 9 or newer, flat config only, and a `recommended` preset that sets no `files`
  and no parser, with a snippet for linting TypeScript. `@noctcore/eslint-utils` ships a README. Rule
  docs describe what a rule does today; third-party credits moved to a short section at the end.

- [#41](https://github.com/noctcore/eslint-plugins/pull/41) [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The rules table in each README is now generated from
  the rules' own metadata, with the same columns in every package: in `recommended`, needs options,
  fixable, suggestions, needs type information. Rule links point at the docs site. Every rule doc
  now opens with a one-line status header saying the same. Rules that do nothing until configured
  carry a new `meta.docs.requiresOptions: true`, and `@noctcore/eslint-utils` types that field
  (`NoctcoreRuleDocs`). A project that spreads `recommended` sees no new errors.
- Updated dependencies [[`da6ce97`](https://github.com/noctcore/eslint-plugins/commit/da6ce97dbfa4eb3a3bb39444929276661d8857b7), [`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885), [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70)]:
  - @noctcore/eslint-plugin-contracts@0.7.1
  - @noctcore/eslint-plugin-prisma@0.5.1

## 0.6.0

### Minor Changes

- [#38](https://github.com/noctcore/eslint-plugins/pull/38) [`b66721d`](https://github.com/noctcore/eslint-plugins/commit/b66721d08cf8cbbbf36f507e75a77d52be27018a) Thanks [@Shironex](https://github.com/Shironex)! - Five rules on two new entry points, promoted from a production NestJS app and parameterised so any project can configure them. None is in `RULE_FACTORIES`, and each is inert until you pass the project's own names, so `createAllRules()` is unchanged and no existing consumer sees a new violation.
  
  `@noctcore/lint-meta-rules/session` fences the seam that mints a session:
  
  - `createSessionMintCallersRule` reports a call to the minting method (`mintCall`) from any file outside `allowedCallers`, so a new sign-in entry point cannot skip the gate in front of the mint.
  - `createSessionKindStampedRule` reports a mint whose options literal never mentions the principal kind (`field`, default `kind`), or a mint with delegated options in a file that never mentions it, unless the file is in `allowUnstamped`.
  - `createSessionEpochCapturedRule` reports a call into the sign-in seam (`call`) whose arguments never mention the revocation epoch (`field`, default `epoch`). Calls are found by balancing parentheses, so a one-line call is checked too.
  - `createSessionLandingDeclaredRule` reports a file that calls a door method (`doorCalls`) without a declared landing in `doors`, a door whose landing demands a return shape it lacks, a door with an unknown landing or an empty reason, and a declared door that no longer exists.
  
  `@noctcore/lint-meta-rules/trpc` adds `createIdempotencyKeyParityRule`, which reports a procedure guarded by an idempotency middleware whose client callers never send the key. The decorator and client shapes default to `nestjs-trpc` and a `trpc.<alias>.<method>` proxy, and are options.
  
  Every rule reads only `sourceGlobs` (or `routerGlobs` and `clientGlobs`), and skips a glob match that is a directory rather than failing on it.

## 0.5.0

### Minor Changes

- [#17](https://github.com/noctcore/eslint-plugins/pull/17) [`fa88b3c`](https://github.com/noctcore/eslint-plugins/commit/fa88b3c629eeab4b18bb061b3240891e9a0f68d8) Thanks [@Shironex](https://github.com/Shironex)! - Two GitHub Actions security rules, both in `RULE_FACTORIES` (so `createAllRules()` now includes them).

  `github-actions-no-template-injection` reports a `${{ }}` expression expanded into a `run:` script or an `actions/github-script` `script:` when it names attacker-controllable context: issue, PR, discussion and comment titles and bodies, head branch names, commit messages and authors, page names, and `inputs.*` (`checkInputs`, on by default; inputs declared `boolean`, `number` or `choice` are exempt). It scans workflows and composite `action.yml` files. The same expression under `env:`, `with:` or `if:` is left alone, as are `github.sha`, `matrix.*`, `secrets.*` and, unless `checkStepOutputs` is on, `steps.*.outputs.*`.

  `github-actions-least-privilege-permissions` reports a workflow with no top-level `permissions:` (unless every job declares its own), a top-level `write-all` or `read-all`, and each top-level `<scope>: write` not listed in `allowTopLevelWrite`.

  A consumer that registers every catalog rule will see new violations wherever its workflows do any of the above.

### Patch Changes

- Updated dependencies [[`7a6494e`](https://github.com/noctcore/eslint-plugins/commit/7a6494e3e9c31cd8e48e76b7365a5a45977cc5a0), [`b117f78`](https://github.com/noctcore/eslint-plugins/commit/b117f78616e798aaae7dffc730bef3c8cc56d8a1)]:
  - @noctcore/eslint-plugin-prisma@0.5.0
  - @noctcore/eslint-plugin-contracts@0.7.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`2f0ab61`](https://github.com/noctcore/eslint-plugins/commit/2f0ab6132241ae12c5c6793ee1829f64d1fd6ffc)]:
  - @noctcore/eslint-plugin-prisma@0.4.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429), [`bc5d82f`](https://github.com/noctcore/eslint-plugins/commit/bc5d82ff4871f2b865aaf0441516f73a58324fc6)]:
  - @noctcore/eslint-plugin-contracts@0.6.0
  - @noctcore/eslint-plugin-prisma@0.3.1

## 0.4.0

### Minor Changes

- [`a417950`](https://github.com/noctcore/eslint-plugins/commit/a41795036482b6ec58eb56ce3593e7bdd4def144) Thanks [@Shironex](https://github.com/Shironex)! - Add three stronger config checks on two new entry points, each parameterised for any project.

  - `@noctcore/lint-meta-rules/resolved-config`: `createEslintConfigNoWarnRule` resolves each package's effective ESLint config with `calculateConfigForFile` and reports any rule that resolves to `warn`, including a severity a spread preset injects, which the text scan of `no-warn-severity` cannot see. It fails closed on a config that cannot be resolved, including one that breaks for a single file shape.
  - `@noctcore/lint-meta-rules/prisma`: `createTenantModelRegistryParityRule` derives the tenant-bearing models from the Prisma schema and asserts the runtime scope map, the injected exemption registry and the tenant rules' resolved `tenantModels` / `handScopedModels` options all agree, so a new tenant-scoped model cannot ship without the guardrails learning about it. `createPrismaMethodSurfaceRule` asserts the Prisma reads and writes the rules police are exactly the generated client's `<Model>Delegate` methods, so a Prisma upgrade cannot add an unguarded method.

  The resolved-config checks are async and need `@noctcore/harness` 0.3.0 (`runAsync`) and the optional `eslint` peer. The package now depends on `@noctcore/eslint-plugin-prisma` for the shared method sets, schema parser and registry reconciliation.

### Patch Changes

- Updated dependencies [[`45e85e4`](https://github.com/noctcore/eslint-plugins/commit/45e85e4fe5cdfe75646fb6cb09adc63a56296644)]:
  - @noctcore/eslint-plugin-prisma@0.3.0

## 0.3.0

### Minor Changes

- [`9b9d078`](https://github.com/noctcore/eslint-plugins/commit/9b9d078290f0ff4a8d8b0ca221bd867f186ca2c6) Thanks [@Shironex](https://github.com/Shironex)! - New: `createTranslationDeadKeysRule`, a whole-program dead translation-key check, on a new entry
  point `@noctcore/lint-meta-rules/i18n`.

  Dead-key detection cannot be sound as an ESLint rule: a per-file rule never sees every call site, and
  keys flow as data. This lint-meta factory walks every configured source file once, resolves call
  sites with the same visitor and catalog loader as `noctcore-contracts/translation-key-exists`, and
  also counts every string literal, template literal and `+` chain in the source as a possible key. It
  reports only keys that no call names and no string spells, and it reports no dead key at all when a
  source file cannot be analysed. Configure it with catalog locations and source globs; there are no
  built-in paths. Blind spots are listed in `docs/rules/translation-dead-keys.md`.

  The main entry point is unchanged and still never loads ESLint. The `i18n` entry needs the optional
  peers `eslint` (>= 9) and `@typescript-eslint/parser`.

  `@noctcore/eslint-plugin-contracts` now exports the i18n building blocks behind
  `translation-key-exists` (`createTranslationVisitor`, `catalogsForNamespace`, `catalogHasKey`,
  `catalogHasPrefix`, `translationSettingsOf`, `TRANSLATION_DEFAULTS` and their types), so the two
  checks share one implementation. Export-only: no rule behaviour changes.

### Patch Changes

- [`d1a1d2c`](https://github.com/noctcore/eslint-plugins/commit/d1a1d2c1a48b62c38138e5b7fa502e64b3533242) Thanks [@Shironex](https://github.com/Shironex)! - Test-only: the five CI-hygiene rules (`github-actions-sha-pinned`, `github-actions-runner-pinned`,
  `service-image-digest-pin`, `dockerfile-base-image-digest-pin`, `security-scanner-version-parity`)
  now also run against a real temp directory containing `.github/workflows/` and `.devcontainer/`,
  through the real `harness lint-meta` CLI under Bun. The fake-context tests could not catch the Bun
  dot-directory glob bug fixed in `@noctcore/harness` 0.3.0; these do. All five fail on harness 0.2.0
  (including the false "no workflow pins" report that hid a real 8.19.0 vs 8.18.0 drift) and pass on
  0.3.0. No runtime change.
- Updated dependencies [[`9b9d078`](https://github.com/noctcore/eslint-plugins/commit/9b9d078290f0ff4a8d8b0ca221bd867f186ca2c6)]:
  - @noctcore/eslint-plugin-contracts@0.5.0

## 0.2.0

### Minor Changes

- [`ce31932`](https://github.com/noctcore/eslint-plugins/commit/ce319327645396110d272864c7e09472cbfc06da) Thanks [@Shironex](https://github.com/Shironex)! - Add five CI-hygiene rule factories (category `ci`): `createGithubActionsShaPinnedRule`, `createGithubActionsRunnerPinnedRule`, `createServiceImageDigestPinRule`, `createDockerfileBaseImageDigestPinRule` and `createSecurityScannerVersionParityRule`. Each project-specific constant (workflow and Dockerfile/compose globs, skip dirs, the floating-label pattern, the unpinned-image exemption list, and the scanner name, variables and hook path) is a factory option with a default.

### Patch Changes

- [`d8c271a`](https://github.com/noctcore/eslint-plugins/commit/d8c271aa57b13361793356329f3361aaa2ef8b06) Thanks [@Shironex](https://github.com/Shironex)! - Bump the `@noctcore/harness` dependency range to `^0.2.0`. No consumed API changed (types and runtime exports used by this package — `IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline` — are unchanged between harness 0.1.0 and 0.2.0); this only widens the resolvable dependency range.

- [`7feaab7`](https://github.com/noctcore/eslint-plugins/commit/7feaab74f3fb393d6d1976640fa79478f7975fea) Thanks [@Shironex](https://github.com/Shironex)! - Require `@noctcore/harness` `^0.3.0`.

  This is a correctness bump, not housekeeping. Harness 0.3.0 fixes `ctx.glob`, which
  under Bun returned an empty list for any dot-directory segment, including a fully
  literal `.github/workflows/ci.yml`. Four of this package's CI-hygiene rules glob
  exactly that path by default, so on harness 0.2.0 under Bun they reported nothing at
  all, and `security-scanner-version-parity` reported a false violation while hiding a
  real scanner drift.

  A caret range on a `0.x` version never crosses the minor, so `^0.2.0` could not pick
  the fix up on its own.
