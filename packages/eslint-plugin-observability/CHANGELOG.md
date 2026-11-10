# @noctcore/eslint-plugin-observability

## 1.0.0

### Major Changes

- [#185](https://github.com/noctcore/eslint-plugins/pull/185) [`3526608`](https://github.com/noctcore/eslint-plugins/commit/3526608ae7491e50ef7253055b97d5befd91571d) Thanks [@Shironex](https://github.com/Shironex)! - First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.
  
  Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.

### Minor Changes

- [#149](https://github.com/noctcore/eslint-plugins/pull/149) [`bd3f645`](https://github.com/noctcore/eslint-plugins/commit/bd3f645b92467a8b1eeb94faa057eaeff63c4e7b) Thanks [@Shironex](https://github.com/Shironex)! - Check the logger methods consumers actually call, and stop `no-sensitive-fields-in-logs` reporting its own advised `redact()` fix.
  
  **A project that spreads `recommended` can see new errors**, which is why this is a minor bump:
  
  - `structured-log-arguments`, `no-sensitive-fields-in-logs` and `no-error-detail-loss` take a new `methods` option. The default adds `log`, `trace`, `fatal` and `verbose` to `info`, `warn`, `error` and `debug`, so `console.log(...)`, Nest's `this.logger.log(...)` / `verbose(...)` / `fatal(...)` and pino's `trace(...)` / `fatal(...)` are now checked. Set `methods: ['info', 'warn', 'error', 'debug']` to keep the old scope.
  - `no-sensitive-fields-in-logs` and `no-error-detail-loss` now read the `loggers` option (`structured-log-arguments` already did). Before, both used the default `console`, `logger`, `log` whatever you configured.
  
  **Reports less:**
  
  - `no-sensitive-fields-in-logs` treats a redactor call as a boundary: it does not look inside `redact(...)` or `mask(...)` (set the list with the new `redactors` option), and an object key whose value is a redactor call is not reported. `logger.info('login', { token: redact(token) })` is clean; before, it gave two errors.
  - `no-sensitive-fields-in-logs` skips names that read as a flag, a count or a timestamp about the field (`hasPassword`, `isTokenValid`, `tokenCount`, `passwordLength`, `tokenExpiresAt`, `cookieConsent`). A new `allowNames` option lists exact names never reported.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`65a5d38`](https://github.com/noctcore/eslint-plugins/commit/65a5d38d04029b10c464ec9c64cc4e13f52147f9) Thanks [@Shironex](https://github.com/Shironex)! - `recommended` now leaves out every rule that needs options to do anything, instead of listing it at `error` or `off` while it checks nothing. Removed entries: architecture `colocated-test-required`; async-safety `require-client-timeout` and `no-shared-mutable-module-state`; contracts `require-registered-keys`, `env-var-schema-parity` and `translation-key-exists`; monorepo `no-deep-package-imports` and `no-unexported-subpath-import` (its preset is now empty); observability `audit-pii-declared`.
  
  No lint result changes for a project that spreads `recommended`: without their options these rules reported nothing. A project that configures one of them by name keeps working unchanged. The README's "Opt-in rules" block shows how to enable each.

### Patch Changes

- [#155](https://github.com/noctcore/eslint-plugins/pull/155) [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5) Thanks [@Shironex](https://github.com/Shironex)! - Cap the peer ranges at what CI tests: `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7` (lint-meta-rules declares only the eslint peer). typescript-eslint 8 refuses TypeScript 7, and no CI leg runs ESLint 11 yet; a range widens once a leg proves the next major.

- [#80](https://github.com/noctcore/eslint-plugins/pull/80) [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c) Thanks [@Shironex](https://github.com/Shironex)! - Give CommonJS consumers their own type declarations. Each `exports` entry now has one `types` per condition: `import` resolves `index.d.ts` and `require` resolves `index.d.cts`, the file tsup already emitted. Before, a CommonJS TypeScript project got the ESM declarations for the `.cjs` build.

- [#165](https://github.com/noctcore/eslint-plugins/pull/165) [`b957e4b`](https://github.com/noctcore/eslint-plugins/commit/b957e4bcf3e5d0723c620609056161bb77e168c9) Thanks [@Shironex](https://github.com/Shironex)! - Internal: use `calleeName` from `@noctcore/eslint-utils` instead of a private copy, and walk the parser's visitor keys instead of `Object.keys` in `no-sensitive-fields-in-logs` and `no-error-detail-loss`. No report changes. The `no-sensitive-fields-in-logs` options now carry schema descriptions.

- [#106](https://github.com/noctcore/eslint-plugins/pull/106) [`1f57e60`](https://github.com/noctcore/eslint-plugins/commit/1f57e6027007cd4956cc9a382c915c1371f2209e) Thanks [@Shironex](https://github.com/Shironex)! - The `recommended` config object now has a `name` (`noctcore-<plugin>/recommended`), so the ESLint config inspector and config error messages show which block it is instead of an anonymous one. Nothing else about the preset changes.

- [#156](https://github.com/noctcore/eslint-plugins/pull/156) [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-utils` now holds the helpers the plugins had copied: `matchesAnyGlob` / `globToRegExp` / `toPosixPath`, `createFileCache` (an mtime-keyed file cache), `calleePath`, `runnerName`, `enclosingFunction` / `isFunctionNode`, `walkSome` / `forEachDescendant`, `isSelfOrAncestor`, `unwrapTypeWrappers`, `isStaticMemberAccess`, and the logger-call detection from the observability plugin. The plugins use them instead of their own copies.
  
  Rule behaviour is unchanged, with one widening of glob syntax: every file-scope option now takes `{a,b}` alternation with wildcards and nesting inside. Before, async-safety and architecture treated braces as literal characters, and react, code-quality and prisma treated wildcards inside braces as literal characters; no real path contains those, so only patterns that could never match before are affected.
- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0

## 0.3.4

### Patch Changes

- [#46](https://github.com/noctcore/eslint-plugins/pull/46) [`59c6c1f`](https://github.com/noctcore/eslint-plugins/commit/59c6c1f900670e9c015429cb6b54787fc6a06719) Thanks [@Shironex](https://github.com/Shironex)! - Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.

## 0.3.3

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

- [`23e4fe1`](https://github.com/noctcore/eslint-plugins/commit/23e4fe19f16ce64c912957cc7aa6f797b31e9660) Thanks [@Shironex](https://github.com/Shironex)! - Add `audit-pii-declared`: a PII-shaped key written into an audit payload (`metadata`, `before`, `after`) must be declared, either in `registeredFields` (the keys a purge job scrubs) or in `nonPiiFields`. Payloads it cannot read are reported unless `reportOpaque` is off. It enforces declaration, not deletion, and is inert until `auditCallees` is set. Enabled at `error` in `recommended`. `no-sensitive-fields-in-logs` now shares its name matcher from `utils`, with no behavior change.
