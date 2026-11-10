# `no-ts-ignore`

> Hand-written source does not suppress TypeScript errors with `@ts-ignore`, or with `@ts-expect-error` unless you allow it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createNoTsIgnoreRule` from `@noctcore/lint-meta-rules/typescript` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

`@ts-ignore` hides every error on the next line, including errors that appear there later: a renamed
property, a changed signature, a value that became `undefined`. The type checker's answer for that
line is gone for good. `@ts-expect-error` is better (it fails once the error it covers disappears)
but it still ships a known type error instead of a fix, which is why it is reported by default too.

## What it flags

Every comment that tsc reads as a suppression, at the line it sits on:

- A comment whose text starts with `@ts-ignore` or `@ts-expect-error`, past any run of slashes or
  stars that opens it (`// @ts-ignore`, `/// @ts-ignore`, `/** @ts-ignore */`).
- A block comment whose last line starts with one (`/* legacy\n@ts-ignore */`).
- A directive with anything glued to its end (`@ts-ignoreX`), since tsc matches it as a prefix.

```ts
// src/load.ts: reported
// @ts-ignore
const port: number = process.env.PORT;
```

## What it does not flag

- Generated files (`*.gen.ts`, `generated/`, `@generated/`).
- The same text in a string, a template, a regex literal, JSX text or mid-sentence in a doc comment.
- A word that only starts like a directive (`@ts-ignorance`).
- `@ts-expect-error`, when `allowExpectError` is on.

## Options

```ts
import { createNoTsIgnoreRule } from '@noctcore/lint-meta-rules/typescript';

createNoTsIgnoreRule(options?: NoTsIgnoreOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sourceGlobs` | `string[]` | `['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']` | Source files to read. `node_modules`, `dist` and similar are always skipped. |
| `allowedFiles` | `string[]` | `[]` | Globs of files where suppressions are allowed. |
| `generatedFiles` | `string[]` | `['**/*.gen.{ts,tsx}', '**/generated/**', '**/@generated/**']` | Globs of generated files, which are skipped. |
| `allowExpectError` | `boolean` | `false` | Report only `@ts-ignore`, allowing `@ts-expect-error` everywhere. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

Type tests that assert an error on purpose are the usual exception. Keep `allowExpectError` off and
list them instead, so the allowance stays where it belongs:

```ts
createNoTsIgnoreRule({ allowedFiles: ['**/*.test-d.ts', 'src/types/**/*.test.ts'] });
```

Needs the optional peer `typescript`.

## When not to use it

In a JavaScript codebase that is not type checked, there are no suppressions to police.
