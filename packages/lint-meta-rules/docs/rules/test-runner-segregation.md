# `test-runner-segregation`

> Bun-side and foreign-side test runners are never mixed within a package.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTestRunnerSegregationRule` from `@noctcore/lint-meta-rules` · Category `testing` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A package that mixes two test runners (e.g. `bun:test` and Vitest) has tests that run under one
command but not another — a coverage gap hiding in plain sight. Segregating the runner by workspace,
and enforcing it per test file, keeps every test attributable to exactly one runner.

## What it flags

Directories split into a **bun set** (from `bunPackageGlobs` minus `vitestDirs`, plus `bunExtraDirs`)
and the **foreign set** (`vitestDirs`). For every `*.test.ts(x)` file:

- **bun-side** — must import the bun runner (`bunRunnerImport`) and must NOT import the foreign runner
  (`foreignRunnerImport`);
- **foreign-side** — must NOT import the bun runner.

## What it does not flag

- A foreign-side test with no direct foreign-runner import: the runner may arrive transitively via
  shared test-utils.
- A bun-side test that imports `bunRunnerImport` and not the foreign runner.
- Anything in a `vitestDirs` directory for a missing bun import (those dirs leave the bun set).
- Files that are not `*.test.ts` / `*.test.tsx` (setup files, helpers), and `require()` or dynamic
  imports: only a `from '<runner>'` import is read.

## Options

```ts
createTestRunnerSegregationRule(options?: TestRunnerSegregationOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `bunPackageGlobs` | `string[]` | `['packages/*/package.json']` | Packages whose dirs default to the bun runner. |
| `bunExtraDirs` | `string[]` | `[]` | Extra bun-runner directories. |
| `vitestDirs` | `string[]` | `[]` | Directories that use the foreign (non-bun) runner. |
| `bunRunnerImport` | `string` | `'bun:test'` | The bun-side runner import specifier. |
| `foreignRunnerImport` | `string` | `'vitest'` | The foreign runner import specifier. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your repo uses a single test runner everywhere, this rule has nothing to segregate.
