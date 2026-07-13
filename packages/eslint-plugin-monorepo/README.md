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

The `recommended` preset registers the plugin but ships every rule **off**, because each needs your
scopes to do anything. Turn them on with your own `scopes`:

```js
import monorepo from '@noctcore/eslint-plugin-monorepo';

export default [
  {
    plugins: { 'noctcore-monorepo': monorepo },
    rules: {
      'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }],
      'noctcore-monorepo/no-unexported-subpath-import': ['error', { scopes: ['@acme'] }],
    },
  },
];
```

## Rules

| Rule | Description | 🔧 |
| --- | --- | --- |
| [`no-deep-package-imports`](./docs/rules/no-deep-package-imports.md) | Require workspace packages in the configured `scopes` to be imported via their barrel, never a deep subpath. | |
| [`no-unexported-subpath-import`](./docs/rules/no-unexported-subpath-import.md) | Forbid importing a `@scope/pkg/<subpath>` that the target workspace package's `exports` map does not expose (read from disk). | |

`no-deep-package-imports` is the strict, barrel-only policy; `no-unexported-subpath-import` is the
looser one — it permits the subpaths a package publishes in `exports` and flags only the ones it does
not. Pick whichever matches how your packages are meant to be consumed.

<!-- More rules land as the `monorepo` package fills out (workspace-dependency hygiene, cross-package layering). -->
