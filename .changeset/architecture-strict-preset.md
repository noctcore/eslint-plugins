---
'@noctcore/eslint-plugin-architecture': minor
---

**Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-architecture/strict`): `recommended` plus the house rules. Every architecture rule encodes a layout convention, so all six rules that `recommended` turned on move to `strict`, and `recommended` now turns nothing on (`single-semantic-module` stays listed at `off`).

Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.

- `filename-matches-export`: 527 / 605 / 499 / 428
- `no-cross-feature-imports`: 252 / 119 / 156 / 29
- `max-import-depth`: 113 / 1 / 28 / 13
- `barrel-purity`: 53 / 36 / 0 / 2
- `index-must-reexport-default`: 0 / 0 / 0 / 197
- `component-folder-structure`: 0 / 0 / 0 / 0 (pure folder shape)

To keep linting as before, spread `architecture.configs.strict` where you spread `architecture.configs.recommended`, or enable the rules one by one. A config that sets these rules by name is unaffected.
