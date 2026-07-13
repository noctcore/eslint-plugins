# `test-runner-segregation`

> Bun-side and foreign-side test runners are never mixed within a package.

## Why

A package that mixes two test runners (e.g. `bun:test` and Vitest) has tests that run under one
command but not another — a coverage gap hiding in plain sight. Segregating the runner by workspace,
and enforcing it per test file, keeps every test attributable to exactly one runner.

## What it flags

Directories split into a **bun set** (from `bunPackageGlobs` minus `vitestDirs`, plus `bunExtraDirs`)
and the **foreign set** (`vitestDirs`). For every `*.test.ts(x)` file:

- **bun-side** — must import the bun runner (`bunRunnerImport`) and must NOT import the foreign runner
  (`foreignRunnerImport`);
- **foreign-side** — must NOT import the bun runner. (A direct foreign-runner import is not required —
  it may arrive transitively via shared test-utils.)

## Factory

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

De-projected from nightcore, which hardcoded `bun:test` vs `vitest` and the two dir sets.

## When not to use it

If your repo uses a single test runner everywhere, this rule has nothing to segregate.
