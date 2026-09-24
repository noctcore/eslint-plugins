# @noctcore/eslint-plugin-async-safety

## 0.4.2

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

## 0.4.1

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

## 0.4.0

### Minor Changes

- [#13](https://github.com/noctcore/eslint-plugins/pull/13) [`05c3764`](https://github.com/noctcore/eslint-plugins/commit/05c37643340ad634a8f16a9b7c3d45a218bc8f4f) Thanks [@Shironex](https://github.com/Shironex)! - New rule `no-leaky-race-timeout`, in `recommended` at `error`. It flags the hand-rolled timeout `Promise.race([work, new Promise((_, reject) => setTimeout(reject, ms))])` when the `setTimeout` handle is discarded, or kept but never passed to `clearTimeout` after the race, so the timer stays pending (and keeps a Node process alive) whenever `work` wins. A `clearTimeout` in a `finally`, in a `.finally(...)` on the race, or after the awaited race counts as a fix, as does switching to `AbortSignal.timeout(ms)`. It leaves alone races without a timer, a `setTimeout` imported from `node:timers/promises`, and handles it cannot follow. A project that spreads `recommended` as-is will see new errors wherever it races an uncleared timer.

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

- [`cf4a5be`](https://github.com/noctcore/eslint-plugins/commit/cf4a5be8b0e57699b2b3b3f95f04dc6c1970acb3) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` presets no longer ship any rule at `warn`. House policy is `error` or `off`: a
  warning is a rule nobody obeys. A test in each package now fails if a preset emits `warn` again.

  `@noctcore/eslint-plugin-async-safety`:

  - `forward-abort-signal`: `warn` to `error`. A dead `signal` parameter is a real bug, and the rule
    already counts any forwarding shape as a pass.
  - `no-concurrent-shared-mutation`: `warn` to `error`. A lost update is a real bug, and the rule
    already skips order-tolerant writes and plain overwrites.
  - `prefer-parallel-awaits`: `warn` to `off`. It is a latency hint, not a correctness bug, and
    sequential awaits are often deliberate (one transaction client, rate limits, ordered test setup).
    Enable it yourself where you want the nudge.

  `@noctcore/eslint-plugin-observability`:

  - `no-sensitive-fields-in-logs`: `warn` to `error`. A miss leaks a credential into a long-lived log
    sink; a false positive costs a rename or an explicit `redact()`. Turn it off in config for tests
    that log a secret on purpose to prove a redaction boundary.

  This can surface new errors in projects that use the preset as-is, hence the minor bump.

## 0.2.0

### Minor Changes

- [`73168a1`](https://github.com/noctcore/eslint-plugins/commit/73168a1970e09c4543b29f88e8616ec12a270bdb) Thanks [@Shironex](https://github.com/Shironex)! - Add `require-client-timeout`: reports a configured client call or `new` whose options object literal sets none of the listed timeout keys. It ships with no built-in client list (`clients: []`, inert by default) and, like `require-fetch-timeout`, stays silent on spreads and opaque option bags. Enabled at `error` in `recommended`.
