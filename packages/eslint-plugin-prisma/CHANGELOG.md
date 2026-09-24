# @noctcore/eslint-plugin-prisma

## 0.5.1

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
- Updated dependencies [[`132a0a0`](https://github.com/noctcore/eslint-plugins/commit/132a0a0dd147abe504a946b1cfd0621b6a103885), [`b25246e`](https://github.com/noctcore/eslint-plugins/commit/b25246e914911df10ab1119252cf665eaa71fb70)]:
  - @noctcore/eslint-utils@0.1.2

## 0.5.0

### Minor Changes

- [#16](https://github.com/noctcore/eslint-plugins/pull/16) [`7a6494e`](https://github.com/noctcore/eslint-plugins/commit/7a6494e3e9c31cd8e48e76b7365a5a45977cc5a0) Thanks [@Shironex](https://github.com/Shironex)! - New rule `no-request-body-in-write`, in `recommended` at `error`: a project that spreads `recommended` will see new errors wherever a Prisma write takes its payload straight from the request.

  It flags mass assignment: a write whose `data` (or an `upsert`'s `create` / `update`) is `req.body`, `request.body`, `ctx.request.body`, `req.query`, `await req.json()`, `await request.json()`, `c.req.json()`, `c.req.parseBody()` or `Object.fromEntries` over a `FormData`, directly, through a `const`, as a spread, as a `createMany` element or inside a nested relation write. It also flags the same input used as a write's `where`, where a caller can send operators and widen an `updateMany` or `deleteMany`. It leaves alone anything parsed first (`Schema.parse(req.body)`), fields picked one by one, and spreads it cannot trace to a source. The source list is the `sources` option.

## 0.4.0

### Minor Changes

- [`2f0ab61`](https://github.com/noctcore/eslint-plugins/commit/2f0ab6132241ae12c5c6793ee1829f64d1fd6ffc) Thanks [@Shironex](https://github.com/Shironex)! - `soft-deletable-tables-require-deleted-at` gains `allowInFunctions`, which exempts named functions in matching files instead of whole files. A call belongs to its nearest named enclosing function, looking through anonymous callbacks, so every other query in an exempt file stays policed.

## 0.3.2

### Patch Changes

- [`734f0f6`](https://github.com/noctcore/eslint-plugins/commit/734f0f610b8b17dd112f514965b3b2d6bbbdf452) Thanks [@Shironex](https://github.com/Shironex)! - Report the real package version in `meta.version`.

  Every plugin published a `meta.version` taken from a literal in its source while the
  version itself came from changesets, so the two drifted: all nine were behind, contracts
  by three minors (it said `0.3.0` while publishing `0.6.0`) and prisma by two (`0.1.0`
  against `0.3.1`). ESLint reads that field to identify a plugin, so anything keyed on
  plugin identity saw a build that had not existed for months.

  The constant is now written from package.json during `version-packages`, and a test
  compares the two so they cannot drift apart again.

- Updated dependencies [[`3166c84`](https://github.com/noctcore/eslint-plugins/commit/3166c8468dcfa29e6c964aa3d0035461b2420e6a)]:
  - @noctcore/eslint-utils@0.1.1

## 0.3.1

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.3.0

### Minor Changes

- [`45e85e4`](https://github.com/noctcore/eslint-plugins/commit/45e85e4fe5cdfe75646fb6cb09adc63a56296644) Thanks [@Shironex](https://github.com/Shironex)! - Add `mutation-entry-must-reach-audit`, the rule that checks audits exist, where `no-audit-write-in-transaction` only checks where they sit.

  For each mutation entry point (a method decorated `@Mutation()` by default, configurable with `entryDecorators`), it follows the calls the TypeScript checker resolved across files and reports the entry when a Prisma write is reachable, no audit write is reachable, and the whole call graph was read. An entry with an edge the rule cannot read (an interface or abstract method, a function held in a parameter, a value typed `any`) is skipped, never reported. `unauditedModels` exempts models whose writes are deliberately not audited, and `ignoreEntries` exempts single entries.

  It proves that an audit is reachable from the entry, not that it runs on every path or records this write, and it does not look at mutations no entry point reaches. It needs type information and throws without it, so it is not in `recommended`. The docs list its blind spots and a measurement on a production API: 80 entries, 7 reported, all 7 hand-checked.

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
