# @noctcore/eslint-plugin-contracts

Rules for shared **contract** conventions — zod schema naming, wire-message discriminants, error
stringification, direct `process.env` access, and money precision. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-contracts   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import contracts from '@noctcore/eslint-plugin-contracts';

export default [
  contracts.configs.recommended,
];
```

Or wire rules individually:

```js
import contracts from '@noctcore/eslint-plugin-contracts';

export default [
  {
    plugins: { 'noctcore-contracts': contracts },
    rules: {
      'noctcore-contracts/zod-schema-naming': ['error', { roleSuffixes: ['Event', 'Command', 'Query'] }],
      'noctcore-contracts/no-direct-process-env': ['error', { configModule: '@acme/config' }],
    },
  },
];
```

## Rules

| Rule | Description | 🔧 |
| --- | --- | --- |
| [`zod-schema-naming`](./docs/rules/zod-schema-naming.md) | Exported zod schema must be a PascalCase `*Schema` const with a sibling `z.infer` type. | |
| [`wire-message-naming`](./docs/rules/wire-message-naming.md) | A role-suffixed schema's `type: z.literal(...)` must be kebab-case of its name minus the suffix. | 🔧 |
| [`no-error-stringify`](./docs/rules/no-error-stringify.md) | Ban `${error}` / `error.toString()` / `error + ""` — they drop the cause chain. | |
| [`no-direct-process-env`](./docs/rules/no-direct-process-env.md) | Ban direct `process.env`; require a typed config accessor. | |
| [`money-must-be-decimal`](./docs/rules/money-must-be-decimal.md) | Money-named fields typed `: number` are banned; require a Decimal money type. | |
