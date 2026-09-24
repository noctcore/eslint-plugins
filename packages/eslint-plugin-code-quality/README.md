# @noctcore/eslint-plugin-code-quality

**Docs:** [noctcore.github.io/eslint-plugins/packages/code-quality](https://noctcore.github.io/eslint-plugins/packages/code-quality/)

Portable code-quality, comment-hygiene, and test-discipline rules. Flat-config only, ESLint 9+.
Every rule keys off code and generic file-path globs, never a specific repo layout.

## Requirements

- ESLint 9 or newer, flat config (`eslint.config.js`) only.
- `configs.recommended` registers the plugin and sets rule severities, nothing else. It sets no
  `files` and no parser, so it applies to whatever files the rest of your config lints. To lint
  TypeScript, add a `files` pattern and `@typescript-eslint/parser`:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import codeQuality from '@noctcore/eslint-plugin-code-quality';

export default [
  {
    ...codeQuality.configs.recommended,
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
];
```

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
| [`no-elided-code-comments`](./docs/rules/no-elided-code-comments.md) | Ban `// ... existing code ...` placeholders that stand in for deleted code. | ✅ | |
| [`no-focused-tests`](./docs/rules/no-focused-tests.md) | Ban focused tests (`.only` / `fdescribe` / `fit`). | ✅ | |
| [`skipped-tests-need-tracking`](./docs/rules/skipped-tests-need-tracking.md) | Skipped tests must carry a tracking marker (issue URL or `TODO(@owner)`). | ✅ | `markers`, `lookback` |
| [`no-vacuous-expect`](./docs/rules/no-vacuous-expect.md) | Ban `typeof` expects, literal tautologies and a sole `toBeDefined`/`toBeTruthy`. | ✅ | `weakMatchers`, `assertionCallees` |
| [`no-conditional-expect`](./docs/rules/no-conditional-expect.md) | Ban `expect()` inside a branch or `catch` that may not run. | ✅ | `checkLoops` |
| [`no-swallowed-assertion`](./docs/rules/no-swallowed-assertion.md) | Ban assertions in a `try` whose `catch` swallows the failure, and `.catch()` on `expect().rejects`. | ✅ | |
| [`fake-timers-must-be-restored`](./docs/rules/fake-timers-must-be-restored.md) | `useFakeTimers()` needs a `useRealTimers()`, here or in the shared suite the file runs. | ✅ | `fakeTimerMethods`, `restoreTimerMethods`, `followImportedSuites`, `sharedSuiteModules` |
| [`no-real-network-in-unit-tests`](./docs/rules/no-real-network-in-unit-tests.md) | Ban real `fetch` / `axios` calls in unit test files. | ✅ | `testFileSuffixes`, `integrationMarkers`, `networkCallees`, `httpClients` |
| [`interface-prefix-i`](./docs/rules/interface-prefix-i.md) | Interface names must be `I` + uppercase. Opinionated house style. | | |
| [`no-template-trim-empty-ternary`](./docs/rules/no-template-trim-empty-ternary.md) | Extract inline `` `…`.trim() === '' ? … `` to a named util. Niche. | | |

## Attribution

`no-vacuous-expect`, `no-conditional-expect`, `fake-timers-must-be-restored` and
`no-real-network-in-unit-tests` are ported from [tsforge](https://github.com/boringstack-xyz/tsforge)
(MIT). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
