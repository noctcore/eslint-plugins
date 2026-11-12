---
'@noctcore/eslint-plugin-contracts': minor
---

`schema-enum-field-consistency` gains a `compareEnumValues` option (default `false`). When on, it reports a field whose `z.enum` value lists differ between two schemas of one file. Only literal lists are compared: an inline array, or a same-file `const` array or `const` enum schema. A project spreading `recommended` or `strict` sees no new errors, because the option is off by default.
