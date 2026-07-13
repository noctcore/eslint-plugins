# @noctcore/eslint-plugin-monorepo

Workspace / monorepo package-boundary rules. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-monorepo   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import monorepo from '@noctcore/eslint-plugin-monorepo';

export default [
  monorepo.configs.recommended,
];
```

The `recommended` preset registers the plugin but ships `no-deep-package-imports` **off**, because it
needs your scopes to do anything. Turn it on with your own `scopes`:

```js
import monorepo from '@noctcore/eslint-plugin-monorepo';

export default [
  {
    plugins: { 'noctcore-monorepo': monorepo },
    rules: {
      'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }],
    },
  },
];
```

## Rules

| Rule | Description | 🔧 |
| --- | --- | --- |
| [`no-deep-package-imports`](./docs/rules/no-deep-package-imports.md) | Require workspace packages in the configured `scopes` to be imported via their barrel, never a deep subpath. | |

<!-- More rules land as the `monorepo` package fills out (workspace-dependency hygiene, cross-package layering). -->
