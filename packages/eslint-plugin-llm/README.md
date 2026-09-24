# @noctcore/eslint-plugin-llm

**Docs:** [noctcore.github.io/eslint-plugins/packages/llm](https://noctcore.github.io/eslint-plugins/packages/llm/)

Rules for code that calls LLM SDKs (OpenAI, Anthropic, the Vercel AI SDK). Model output is
untrusted input, and these rules catch it reaching a sink before anything checked it. Syntactic,
no type information. Flat-config only, ESLint 9+.

## Requirements

- ESLint 9 or newer, flat config (`eslint.config.js`) only.
- `configs.recommended` registers the plugin and sets rule severities, nothing else. It sets no
  `files` and no parser, so it applies to whatever files the rest of your config lints. To lint
  TypeScript, add a `files` pattern and `@typescript-eslint/parser`:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import llm from '@noctcore/eslint-plugin-llm';

export default [
  {
    ...llm.configs.recommended,
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
];
```

## Install

```sh
bun add -D @noctcore/eslint-plugin-llm   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import llm from '@noctcore/eslint-plugin-llm';

export default [
  llm.configs.recommended,
];
```

## Rules

| Rule | Description | Recommended |
| --- | --- | --- |
| [`no-llm-output-to-sink`](./docs/rules/no-llm-output-to-sink.md) | Text an LLM SDK call returned must not reach `eval`, a shell, raw SQL, HTML injection, a `fetch` origin or an `fs` path without being validated or sanitized first ([OWASP LLM05](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)). | `error` |
