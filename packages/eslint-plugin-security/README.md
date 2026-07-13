# @noctcore/eslint-plugin-security

Injection / path-traversal precision rules. High-precision syntactic sinks only — precision is the
point. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-security   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import security from '@noctcore/eslint-plugin-security';

export default [
  security.configs.recommended,
];
```

Or wire rules individually — including the opt-in `require-path-containment`:

```js
import security from '@noctcore/eslint-plugin-security';

export default [
  {
    plugins: { 'noctcore-security': security },
    rules: {
      'noctcore-security/no-shell-interpolation': ['error', { extraCallees: ['sh'] }],
      // High false-positive; enable explicitly (omitted from `recommended`).
      'noctcore-security/require-path-containment': ['warn', { requestObjects: ['req', 'ctx'] }],
    },
  },
];
```

## Rules

| Rule | Description | Recommended |
| --- | --- | --- |
| [`no-shell-interpolation`](./docs/rules/no-shell-interpolation.md) | A dynamically-built command string must not flow into a shell runner (`exec`/`execSync`, or `spawn`/`execFile` with `shell: true`). | `error` |
| [`require-path-containment`](./docs/rules/require-path-containment.md) | `req.*` input passed directly into `path.join` / `path.resolve` without a containment guard. | opt-in (off) |
