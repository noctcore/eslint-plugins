---
'@noctcore/eslint-plugin-architecture': minor
---

`single-semantic-module` gains a `schemaFactories` option, for example `['errorOf']`. A call rooted at a listed name, such as `export const NotFound = errorOf('not-found')`, counts as `schema` instead of `constant`, so a schemas-only module built with a local helper is no longer reported as mixing kinds. The default is an empty list, so existing configs behave exactly as before. The rule ships `off` in `recommended`, so a project spreading `recommended` sees no new errors.
