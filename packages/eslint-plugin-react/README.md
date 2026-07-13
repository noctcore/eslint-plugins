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
| [`no-prop-drilling`](./docs/rules/no-prop-drilling.md) | Flag a bundle of props forwarded unchanged to the same child. | |

<!-- More rules land as the `react` package fills out (state colocation, memoized context, effect safety). -->
