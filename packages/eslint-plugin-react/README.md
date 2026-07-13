# @noctcore/eslint-plugin-react

General-purpose React architecture + correctness rules. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-react   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import react from '@noctcore/eslint-plugin-react';

export default [
  react.configs.recommended,
];
```

Or wire rules individually:

```js
import react from '@noctcore/eslint-plugin-react';

export default [
  {
    plugins: { 'noctcore-react': react },
    rules: {
      'noctcore-react/no-prop-drilling': ['error', { maxForwarded: 4 }],
    },
  },
];
```

## Rules

| Rule | Description | 🔧 |
| --- | --- | --- |
| [`context-value-must-be-memoized`](./docs/rules/context-value-must-be-memoized.md) | Forbid inline object literals as a context Provider `value`. | |
| [`max-hook-return-surface`](./docs/rules/max-hook-return-surface.md) | Cap the return surface of an exported hook (god-controller guard). | |
| [`max-hooks-per-file`](./docs/rules/max-hooks-per-file.md) | Limit exported `use*` hooks in a hook/query/mutation file. | |
| [`max-props-per-component`](./docs/rules/max-props-per-component.md) | Cap locally-declared members in a `*Props` contract. | |
| [`no-jsx-computation`](./docs/rules/no-jsx-computation.md) | Disallow array methods, arithmetic, and chained logic inside JSX `{...}`. | |
| [`no-prop-drilling`](./docs/rules/no-prop-drilling.md) | Flag a bundle of props forwarded unchanged to the same child. | |
| [`no-state-in-component-body`](./docs/rules/no-state-in-component-body.md) | Keep state/effect/query hooks in the colocated hook file, not the component body. | |
| [`props-must-be-visual`](./docs/rules/props-must-be-visual.md) | Disallow auth/identity/credential names in `*Props` contracts. | |
