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
| [`component-props-naming`](./docs/rules/component-props-naming.md) | Require a component's first-param props type to be named `<Component>Props`. | 🔧 |
| [`context-value-must-be-memoized`](./docs/rules/context-value-must-be-memoized.md) | Forbid inline object literals as a context Provider `value`. | |
| [`max-hook-return-surface`](./docs/rules/max-hook-return-surface.md) | Cap the return surface of an exported hook (god-controller guard). | |
| [`max-hooks-per-file`](./docs/rules/max-hooks-per-file.md) | Limit exported `use*` hooks in a hook/query/mutation file. | |
| [`max-props-per-component`](./docs/rules/max-props-per-component.md) | Cap locally-declared members in a `*Props` contract. | |
| [`no-effect-derived-state`](./docs/rules/no-effect-derived-state.md) | Flag an effect that only sets state derived from its dependencies. | |
| [`no-jsx-computation`](./docs/rules/no-jsx-computation.md) | Disallow array methods, arithmetic, and chained logic inside JSX `{...}`. | |
| [`no-jsx-in-hooks`](./docs/rules/no-jsx-in-hooks.md) | Forbid a `use*`-named function from returning JSX. | |
| [`no-prop-drilling`](./docs/rules/no-prop-drilling.md) | Flag a bundle of props forwarded unchanged to the same child. | |
| [`no-state-in-component-body`](./docs/rules/no-state-in-component-body.md) | Keep state/effect/query hooks in the colocated hook file, not the component body. | |
| [`prefer-lazy-state-init`](./docs/rules/prefer-lazy-state-init.md) | Wrap an expensive `useState` initializer call in a lazy function. | 🔧 |
| [`props-must-be-visual`](./docs/rules/props-must-be-visual.md) | Disallow auth/identity/credential names in `*Props` contracts. | |
| [`require-effect-cancellation`](./docs/rules/require-effect-cancellation.md) | Flag an unguarded `setState` after an `await`/`.then` inside an effect. | |
