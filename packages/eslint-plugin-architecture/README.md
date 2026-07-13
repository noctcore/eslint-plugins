# @noctcore/eslint-plugin-architecture

Framework-agnostic folder-per-component and feature-boundary architecture rules. Flat-config only,
ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-architecture   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import architecture from '@noctcore/eslint-plugin-architecture';

export default [
  architecture.configs.recommended,
];
```

Or wire rules individually:

```js
import architecture from '@noctcore/eslint-plugin-architecture';

export default [
  {
    plugins: { 'noctcore-architecture': architecture },
    rules: {
      'noctcore-architecture/component-folder-structure': ['error', { componentRoot: 'components' }],
      'noctcore-architecture/no-cross-feature-imports': ['error', { alias: '@/components' }],
      'noctcore-architecture/index-must-reexport-default': 'error',
    },
  },
];
```

Every rule anchors on a configurable directory segment (default `components`) rather than an absolute
path, so it behaves the same whether ESLint runs from the repo root or per-package, on POSIX or
Windows. Two of the three rules inspect files on disk (sibling sets, barrel siblings), so run ESLint
against real file paths, not virtual sources.

## Rules

| Rule | Description | 🔧 |
| --- | --- | --- |
| [`component-folder-structure`](./docs/rules/component-folder-structure.md) | A component entry file must ship its full sibling set (hooks, types, story, test, barrel) on disk. | |
| [`index-must-reexport-default`](./docs/rules/index-must-reexport-default.md) | A component folder's `index.ts` must re-export the sibling default named after the folder. | |
| [`no-cross-feature-imports`](./docs/rules/no-cross-feature-imports.md) | A file in one feature may not import runtime code from another feature. | |
