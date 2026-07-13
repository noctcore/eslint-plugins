# @noctcore/eslint-plugin-observability

Structured-logging discipline rules — context objects over interpolated messages, no sensitive fields
in logs, no error-detail loss. Flat-config only, ESLint 9+.

## Install

```sh
bun add -D @noctcore/eslint-plugin-observability   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import observability from '@noctcore/eslint-plugin-observability';

export default [
  observability.configs.recommended,
];
```

Or wire rules individually:

```js
import observability from '@noctcore/eslint-plugin-observability';

export default [
  {
    plugins: { 'noctcore-observability': observability },
    rules: {
      'noctcore-observability/structured-log-arguments': ['error', { loggers: ['log', 'audit'] }],
    },
  },
];
```

## Rules

| Rule | Description | Recommended |
| --- | --- | --- |
| [`structured-log-arguments`](./docs/rules/structured-log-arguments.md) | Pass dynamic values in a structured context object, not interpolated into the message string. | `error` |
| [`no-sensitive-fields-in-logs`](./docs/rules/no-sensitive-fields-in-logs.md) | Name-heuristic guard against writing credentials/secrets into log sinks. | `warn` |
| [`no-error-detail-loss`](./docs/rules/no-error-detail-loss.md) | A catch block that reports failure must log the error itself, not only `e.message`. | `error` |
