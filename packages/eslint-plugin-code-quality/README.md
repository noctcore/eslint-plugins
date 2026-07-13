# @noctcore/eslint-plugin-code-quality

Portable code-quality, comment-hygiene, and test-discipline rules. Flat-config only, ESLint 9+.
Every rule is de-projected — it keys off code and generic file-path globs, never a specific
repo layout.

## Install

```sh
bun add -D @noctcore/eslint-plugin-code-quality   # or npm i -D / pnpm add -D
```

## Use

```js
// eslint.config.js
import codeQuality from '@noctcore/eslint-plugin-code-quality';

export default [
  codeQuality.configs.recommended,
];
```

Or wire rules individually (including the ones not in `recommended`):

```js
import codeQuality from '@noctcore/eslint-plugin-code-quality';

export default [
  {
    plugins: { 'noctcore-code-quality': codeQuality },
    rules: {
      'noctcore-code-quality/no-process-exit': ['error', { allowIn: ['**/scripts/**'] }],
      // Opinionated / niche — off by default, opt in here:
      'noctcore-code-quality/interface-prefix-i': 'error',
      'noctcore-code-quality/no-template-trim-empty-ternary': 'error',
    },
  },
];
```

## Rules

`recommended` = ✅ enabled by the `recommended` preset. The two unchecked rules are exported and
documented but off by default (opinionated / niche) — enable them explicitly.

| Rule | Description | Recommended | Options |
| --- | --- | --- | --- |
| [`prefer-early-return`](./docs/rules/prefer-early-return.md) | Prefer a guard clause over wrapping the whole function body in an `if`. | ✅ | |
| [`no-process-exit`](./docs/rules/no-process-exit.md) | Ban `process.exit()` outside bootstrap/shutdown paths and CLIs. | ✅ | `allowIn` |
| [`no-bare-date-now`](./docs/rules/no-bare-date-now.md) | Ban bare `Date.now()` / `new Date()`; read time through a mockable `clock`. | ✅ | `allowIn` |
| [`no-historical-comments`](./docs/rules/no-historical-comments.md) | Ban comments framing code against its past ("before the fix", "used to"). | ✅ | |
| [`no-narration-comments`](./docs/rules/no-narration-comments.md) | Ban step-by-step "Now we… / First we…" narration comments. | ✅ | |
| [`no-pr-reference-comments`](./docs/rules/no-pr-reference-comments.md) | Ban PR/issue references in comments. | ✅ | |
| [`no-focused-tests`](./docs/rules/no-focused-tests.md) | Ban focused tests (`.only` / `fdescribe` / `fit`). | ✅ | |
| [`skipped-tests-need-tracking`](./docs/rules/skipped-tests-need-tracking.md) | Skipped tests must carry a tracking marker (issue URL or `TODO(@owner)`). | ✅ | `markers`, `lookback` |
| [`interface-prefix-i`](./docs/rules/interface-prefix-i.md) | Interface names must be `I` + uppercase. Opinionated house style. | | |
| [`no-template-trim-empty-ternary`](./docs/rules/no-template-trim-empty-ternary.md) | Extract inline `` `…`.trim() === '' ? … `` to a named util. Niche. | | |
