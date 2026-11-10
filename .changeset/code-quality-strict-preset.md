---
'@noctcore/eslint-plugin-code-quality': minor
---

**Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-code-quality/strict`): `recommended` plus the house rules. `prefer-early-return` (a style preference with no fix) and `no-bare-date-now` (asks for a project clock seam) leave `recommended` and are on in `strict`. `prefer-early-return` is also retyped from `problem` to `suggestion`, since it reports style, not a defect.

Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.

- `prefer-early-return`: 31 / 49 / 86 / 53
- `no-bare-date-now`: 26 / 104 / 110 / 76

`interface-prefix-i` and `no-template-trim-empty-ternary` stay opt-in and are not in `strict` (`interface-prefix-i` contradicts react's `component-props-naming`). To keep linting as before, spread `codeQuality.configs.strict` where you spread `codeQuality.configs.recommended`, or enable the two rules by name.
