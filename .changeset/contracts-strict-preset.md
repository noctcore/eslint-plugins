---
'@noctcore/eslint-plugin-contracts': minor
---

**Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-contracts/strict`): `recommended` plus the house rules. The two naming conventions leave `recommended` and are on in `strict`: `zod-schema-naming` (PascalCase `FooSchema`, where many codebases write `fooSchema`) and `wire-message-naming` (a message's `type` literal derived from its const name).

Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.

- `zod-schema-naming`: 229 / 8 / 126 / 72
- `wire-message-naming`: 0 / 0 / 0 / 0

To keep linting as before, spread `contracts.configs.strict` where you spread `contracts.configs.recommended`, or enable the two rules by name.
