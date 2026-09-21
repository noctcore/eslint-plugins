---
"@noctcore/eslint-plugin-contracts": minor
---

Add `translation-key-exists`: a static i18next / react-i18next translation key (`t(...)`, `i18n.t(...)`, `getFixedT`, `<Trans i18nKey>`) must exist in the catalog of the namespace in scope. Namespace-aware (`useTranslation('ns')`, namespace arrays, `keyPrefix`, `ns:key`, `{ ns }`, `TFunction<'ns'>` parameters, same-file constants, a `namespaceIdentifiers` map, and literal types under typed linting), plural and context aware, and silent on dynamic keys and opaque options. Catalog locations are configured with `catalogs` (`{ns}` templates, `keyPath` subtrees); there is no built-in location. Ships `off` in `recommended` until configured.
