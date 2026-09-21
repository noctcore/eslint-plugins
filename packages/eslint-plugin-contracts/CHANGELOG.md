# @noctcore/eslint-plugin-contracts

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
