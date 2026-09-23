# @noctcore/eslint-plugin-rsc

React Server Components and App Router correctness rules: the server-side control flow that
compiles, type-checks and still silently does the wrong thing. Framework-neutral where the RSC
model allows; a rule tied to one framework's API (Next.js `next/navigation`, for example) says so
and only fires on that framework's imports. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-rsc   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import rsc from '@noctcore/eslint-plugin-rsc';

export default [
  rsc.configs.recommended,
];
```

## Rules

| Rule | Description | Recommended |
| --- | --- | --- |
| [`no-navigation-throw-in-try`](./docs/rules/no-navigation-throw-in-try.md) | A `next/navigation` `redirect` / `permanentRedirect` / `notFound` / `forbidden` / `unauthorized` call must not sit in a `try` whose `catch` swallows it; call `unstable_rethrow(error)` or rethrow. | `error` |
