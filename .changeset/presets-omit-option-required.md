---
'@noctcore/eslint-plugin-architecture': minor
'@noctcore/eslint-plugin-async-safety': minor
'@noctcore/eslint-plugin-contracts': minor
'@noctcore/eslint-plugin-monorepo': minor
'@noctcore/eslint-plugin-observability': minor
---

`recommended` now leaves out every rule that needs options to do anything, instead of listing it at `error` or `off` while it checks nothing. Removed entries: architecture `colocated-test-required`; async-safety `require-client-timeout` and `no-shared-mutable-module-state`; contracts `require-registered-keys`, `env-var-schema-parity` and `translation-key-exists`; monorepo `no-deep-package-imports` and `no-unexported-subpath-import` (its preset is now empty); observability `audit-pii-declared`.

No lint result changes for a project that spreads `recommended`: without their options these rules reported nothing. A project that configures one of them by name keeps working unchanged. The README's "Opt-in rules" block shows how to enable each.
