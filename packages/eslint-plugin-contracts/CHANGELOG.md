# @noctcore/eslint-plugin-contracts

## 0.7.1

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

## 0.7.0

### Minor Changes

- [#14](https://github.com/noctcore/eslint-plugins/pull/14) [`b117f78`](https://github.com/noctcore/eslint-plugins/commit/b117f78616e798aaae7dffc730bef3c8cc56d8a1) Thanks [@Shironex](https://github.com/Shironex)! - `require-schema-parse-at-boundary` now follows same-function `const` bindings and knows more
  boundary reads. `const raw = await res.json(); return raw as User;` is reported, unless the binding
  is read before the cast by anything other than another cast (a guard, a validator call, an `in`
  check) or from a nested function; `let`, destructuring and parameters are not followed. New
  built-in sources: `localStorage.getItem` / `sessionStorage.getItem`, `URLSearchParams` `.get` /
  `.getAll` (including `<x>.searchParams` and a `searchParams` binding), `event.data` in a `message`
  listener, and an Anthropic `tool_use` block's `.input` when a `block.type === 'tool_use'` guard,
  `case`, `.find` or `.filter` proves the block type. OpenAI `JSON.parse(call.function.arguments)` was
  already covered by `JSON.parse`. A union cast target containing a shape claim (`as User | null`) now
  counts as a shape claim. The new `boundaries` option adds your own callees (`readBody`,
  `ipcRenderer.invoke`); it defaults to `[]`.

  The rule stays `off` in `recommended`, so a project that spreads `recommended` as-is sees no new
  errors. A project that has enabled the rule can see new errors from the binding-following, the new
  sources and the union targets.

## 0.6.1

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

## 0.6.0

### Minor Changes

- [`bc5d82f`](https://github.com/noctcore/eslint-plugins/commit/bc5d82ff4871f2b865aaf0441516f73a58324fc6) Thanks [@Shironex](https://github.com/Shironex)! - `@noctcore/eslint-plugin-react`: **behaviour change for consumers.** The `recommended` preset no
  longer ships any rule at `warn`. House policy is `error` or `off`: a warning is a rule nobody obeys,
  and a project that refuses `warn` in its resolved config could not use the preset at all.

  - `no-effect-derived-state`: `warn` to `error`. It fires only on an effect whose whole body is
    `setX(...)` of values read from its own deps; any branch, call, await or cleanup bails out.
  - `require-effect-cancellation`: `warn` to `error`. A state update after an await with nothing to
    cancel it is a real bug, and any recognisable guard (an `AbortController`, a `cancelled` flag, a
    cleanup `return`) silences it.

  Projects that spread `react.configs.recommended` as-is will now fail lint on findings that used to
  print as warnings. To keep the old behaviour, set either rule back yourself after the preset. A test
  in every plugin now fails if any preset emits `warn`.

  `@noctcore/eslint-plugin-contracts`: `money-must-be-decimal` gains a `minorUnitPatterns` option.
  Payment APIs such as Stripe carry money as an integer count of minor units (`amount: 1999` is
  19.99), which is exact in a `number`. List the regex fragments (case-insensitive, unanchored, so
  anchor them: `['^amount$', 'Cents$']`) that name such fields and the rule skips them. The default is
  empty, so nothing changes until you opt in.

### Patch Changes

- [`bd6d25e`](https://github.com/noctcore/eslint-plugins/commit/bd6d25e7a0a0d46bd62b331d52acaf890171c429) Thanks [@Shironex](https://github.com/Shironex)! - Every rule doc's examples now run as tests. Each fence is labelled `bad` (the rule must report it), `good` (the rule must not), or `prose` (not run, with the reason stated), and a good example that only passes by moving file or changing options says so.

  Running them corrected three docs. `no-sensitive-fields-in-logs` offered `{ password: redact(password) }` as the fix, which the rule reports twice. `prefer-parallel-awaits` showed module-scope awaits, which the rule never checks. `single-semantic-module` fenced a JSX example as `ts`, where it does not parse. `no-process-exit` gained the example it never had.

## 0.5.0

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

## 0.4.0

### Minor Changes

- [`181d829`](https://github.com/noctcore/eslint-plugins/commit/181d829e29fddcb56ead64ce2093847e5e785dcc) Thanks [@Shironex](https://github.com/Shironex)! - Add `translation-key-exists`: a static i18next / react-i18next translation key (`t(...)`, `i18n.t(...)`, `getFixedT`, `<Trans i18nKey>`) must exist in the catalog of the namespace in scope. Namespace-aware (`useTranslation('ns')`, namespace arrays, `keyPrefix`, `ns:key`, `{ ns }`, `TFunction<'ns'>` parameters, same-file constants, a `namespaceIdentifiers` map, and literal types under typed linting), plural and context aware, and silent on dynamic keys and opaque options. Catalog locations are configured with `catalogs` (`{ns}` templates, `keyPath` subtrees); there is no built-in location. Ships `off` in `recommended` until configured.

## 0.3.0

### Minor Changes

- [`c351d42`](https://github.com/noctcore/eslint-plugins/commit/c351d4243378cfc147ccc825873b1adcacb1bbad) Thanks [@Shironex](https://github.com/Shironex)! - Add `fetch-must-check-ok`: a fetch response must be checked with `.ok` or a status comparison before `.json()` parses its body. Ported from tsforge `typescript-core/fetch-must-check-ok` (MIT) with its full test suite. Adds a `fetchFunctions` option (default `['fetch']`) for wrappers and dotted callees. On at `error` in `recommended`.

- [`d8bc7f4`](https://github.com/noctcore/eslint-plugins/commit/d8bc7f435398af6c286d034461f7721fa4052461) Thanks [@Shironex](https://github.com/Shironex)! - Add `schema-enum-field-consistency`: a field that is an enum in one zod object schema of a module must not be widened to `z.string()` in another, which leaks `string` to every consumer of the wire type. Upstreamed from Settly's local rule. Options: `zodIdentifiers` (default `['z']`), `ignoreFields` (default `[]`), `enumIdentifierPattern` (default unset). On at `error` in `recommended`.

## 0.2.0

### Minor Changes

- Add 5 rules: `require-error-cause` (fixable) and `restrict-throw-to-taxonomy` in recommended, plus inert-until-configured `require-registered-keys`, `env-var-schema-parity`, and `require-schema-parse-at-boundary`.
