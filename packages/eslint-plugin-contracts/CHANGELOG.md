# @noctcore/eslint-plugin-contracts

## 0.3.0

### Minor Changes

- [`c351d42`](https://github.com/noctcore/eslint-plugins/commit/c351d4243378cfc147ccc825873b1adcacb1bbad) Thanks [@Shironex](https://github.com/Shironex)! - Add `fetch-must-check-ok`: a fetch response must be checked with `.ok` or a status comparison before `.json()` parses its body. Ported from tsforge `typescript-core/fetch-must-check-ok` (MIT) with its full test suite. Adds a `fetchFunctions` option (default `['fetch']`) for wrappers and dotted callees. On at `error` in `recommended`.

- [`d8bc7f4`](https://github.com/noctcore/eslint-plugins/commit/d8bc7f435398af6c286d034461f7721fa4052461) Thanks [@Shironex](https://github.com/Shironex)! - Add `schema-enum-field-consistency`: a field that is an enum in one zod object schema of a module must not be widened to `z.string()` in another, which leaks `string` to every consumer of the wire type. Upstreamed from Settly's local rule. Options: `zodIdentifiers` (default `['z']`), `ignoreFields` (default `[]`), `enumIdentifierPattern` (default unset). On at `error` in `recommended`.

## 0.2.0

### Minor Changes

- Add 5 rules: `require-error-cause` (fixable) and `restrict-throw-to-taxonomy` in recommended, plus inert-until-configured `require-registered-keys`, `env-var-schema-parity`, and `require-schema-parse-at-boundary`.
