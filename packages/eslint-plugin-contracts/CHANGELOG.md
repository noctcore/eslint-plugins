# @noctcore/eslint-plugin-contracts

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
