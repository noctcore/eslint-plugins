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

Legend: 🔧 = autofixable · 💤 = ships inert / `off` in `recommended` (enable + configure explicitly).

| Rule | Description | 🔧 | 💤 |
| --- | --- | --- | --- |
| [`zod-schema-naming`](./docs/rules/zod-schema-naming.md) | Exported zod schema must be a PascalCase `*Schema` const with a sibling `z.infer` type. | | |
| [`wire-message-naming`](./docs/rules/wire-message-naming.md) | A role-suffixed schema's `type: z.literal(...)` must be kebab-case of its name minus the suffix. | 🔧 | |
| [`no-error-stringify`](./docs/rules/no-error-stringify.md) | Ban `${error}` / `error.toString()` / `error + ""` — they drop the cause chain. | | |
| [`no-direct-process-env`](./docs/rules/no-direct-process-env.md) | Ban direct `process.env`; require a typed config accessor. | | |
| [`money-must-be-decimal`](./docs/rules/money-must-be-decimal.md) | Money-named fields typed `: number` are banned; require a Decimal money type. | | |
| [`require-error-cause`](./docs/rules/require-error-cause.md) | Re-throwing a new error inside `catch` must forward the caught error as `{ cause }`. | 🔧 | |
| [`restrict-throw-to-taxonomy`](./docs/rules/restrict-throw-to-taxonomy.md) | `throw` only allowlisted error classes; ban throwing non-Error values. | | |
| [`require-registered-keys`](./docs/rules/require-registered-keys.md) | Key/name argument of a configured sink API must be an imported constant, not a raw string. | | 💤 |
| [`env-var-schema-parity`](./docs/rules/env-var-schema-parity.md) | `process.env.FOO` / `import.meta.env.FOO` keys must be declared in a schema file. | | 💤 |
| [`require-schema-parse-at-boundary`](./docs/rules/require-schema-parse-at-boundary.md) | Ban `JSON.parse(...) as T` / `(await res.json()) as T`; parse boundary data at runtime. | | 💤 |

The 💤 rules ship `off` in `recommended`: `require-registered-keys` and `env-var-schema-parity` do
nothing until their `sinks` / `schema` options are set, and `require-schema-parse-at-boundary` is a
conservative syntactic slice of a type-aware concern. Turn them on explicitly once configured.
