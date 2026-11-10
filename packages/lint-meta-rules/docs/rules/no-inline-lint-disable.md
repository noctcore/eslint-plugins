# `no-inline-lint-disable`

> Hand-written source carries no inline `eslint-disable` directive; a deliberate exception belongs in a scoped config override.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createNoInlineLintDisableRule` from `@noctcore/lint-meta-rules/typescript` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

An inline disable turns a rule off where nobody reviews it again. It survives the refactor that made
it unnecessary, it is copied along with the code around it, and a reviewer reads it as a decision
someone already made. A `files` override in the ESLint config does the same job in one place, with
its reason next to it, where a change to the rule set is reviewed as one.

ESLint's own `--report-unused-disable-directives` catches a disable that no longer suppresses
anything; this rule catches the ones that still do.

## What it flags

Every comment that ESLint reads as a disable directive: one whose trimmed body starts with
`eslint-disable`, `eslint-disable-line` or `eslint-disable-next-line`, in a line or block comment.
The message gives the line.

```ts
// src/report.ts: reported (line 1)
// eslint-disable-next-line no-console
console.log(summary);
```

## What it does not flag

- Generated files (`*.gen.ts`, `generated/`, `@generated/`), whose blanket suppressions are the
  generator's business.
- The same text anywhere else: in a string, a template, a regex literal, JSX text, or prose inside a
  doc comment. The file is parsed with the TypeScript parser, so a rule that names the directive in
  its own message or pattern is not mistaken for a violation.
- `eslint-enable`, and a word that only starts like a directive (`eslint-disabled`).

## Options

```ts
import { createNoInlineLintDisableRule } from '@noctcore/lint-meta-rules/typescript';

createNoInlineLintDisableRule(options?: NoInlineLintDisableOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sourceGlobs` | `string[]` | `['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']` | Source files to read. `node_modules`, `dist` and similar are always skipped. |
| `allowedFiles` | `string[]` | `[]` | Globs of files where a directive is allowed (a vendored file). |
| `generatedFiles` | `string[]` | `['**/*.gen.{ts,tsx}', '**/generated/**', '**/@generated/**']` | Globs of generated files, which are skipped. |
| `allowWithDescription` | `boolean` | `false` | Allow a directive that gives its reason after ` -- `. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

Needs the optional peer `typescript`.

## When not to use it

If your team allows inline disables with a reason, set `allowWithDescription: true` rather than
dropping the rule; if it allows them freely, skip it.
