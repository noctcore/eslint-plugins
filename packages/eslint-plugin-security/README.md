# @noctcore/eslint-plugin-security

Injection, path-traversal, SSRF and open-redirect precision rules. High-precision syntactic sinks only; precision is the
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
      'noctcore-security/require-path-containment': ['error', { requestObjects: ['req', 'ctx'] }],
      // Needs your action-client names; with none configured it reports every exported action.
      'noctcore-security/server-action-through-client': ['error', { actionClients: ['actionClient', 'authActionClient'] }],
    },
  },
];
```

## Rules

| Rule | Description | Recommended |
| --- | --- | --- |
| [`no-shell-interpolation`](./docs/rules/no-shell-interpolation.md) | A dynamically-built command string must not flow into a shell runner (`exec`/`execSync`, or `spawn`/`execFile` with `shell: true`). | `error` |
| [`no-user-controlled-fetch-url`](./docs/rules/no-user-controlled-fetch-url.md) | `fetch` / `axios` URL whose origin is not fixed at authoring time (SSRF), including the `https://host${p}` userinfo trick. | `error` |
| [`no-user-controlled-redirect`](./docs/rules/no-user-controlled-redirect.md) | Redirect target whose origin is not fixed at authoring time (open redirect); understands Express `res.redirect(302, url)`. | `error` |
| [`require-path-containment`](./docs/rules/require-path-containment.md) | `req.*` input passed directly into `path.join` / `path.resolve` without a containment guard. | opt-in (off) |
| [`server-action-through-client`](./docs/rules/server-action-through-client.md) | In a `'use server'` module, every exported action must be built from a configured action client; no raw `export async function`. | opt-in (off), needs `actionClients` |
