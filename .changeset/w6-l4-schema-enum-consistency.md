---
"@noctcore/eslint-plugin-contracts": minor
---

Add `schema-enum-field-consistency`: a field that is an enum in one zod object schema of a module must not be widened to `z.string()` in another, which leaks `string` to every consumer of the wire type. Upstreamed from Settly's local rule. Options: `zodIdentifiers` (default `['z']`), `ignoreFields` (default `[]`), `enumIdentifierPattern` (default unset). On at `error` in `recommended`.
