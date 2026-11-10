---
'@noctcore/eslint-plugin-react': minor
---

**Breaking for configs that spread `recommended`.** New `configs.strict` preset (`noctcore-react/strict`): `recommended` plus the house rules. The props naming scheme, the size caps and the thin component shell leave `recommended` and are on in `strict`.

Hits are from linting `apps/*/src` and `packages/*/src` of four consumer monorepos (about 1,800 to 2,500 files each) with the current rules and no inline disables, listed as A / B / C / D.

- `no-jsx-computation`: 46 / 29 / 134 / 235
- `no-state-in-component-body`: 106 / 137 / 158 / 35
- `component-props-naming`: 44 / 38 / 45 / 0
- `max-hook-return-surface`: 10 / 32 / 9 / 7
- `max-props-per-component`: 5 / 2 / 3 / 3
- `max-hooks-per-file`: 0 / 0 / 0 / 0 (size cap)

To keep linting as before, spread `react.configs.strict` where you spread `react.configs.recommended`, or enable the rules one by one.
