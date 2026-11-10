# `test-file-matches-runner-include`

> Every test file matches the include patterns of a test runner that covers its directory, so a test that never runs cannot pass as coverage.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTestFileMatchesRunnerIncludeRule` from `@noctcore/lint-meta-rules/typescript` · Category `testing` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A runner only runs what its `include` collects. Name a file `format.utils.test.ts` in a project
whose Vitest config includes `src/**/*.test.tsx`, and that file never runs: no failure, no skip, no
line in the output. Meanwhile every check that only looks for the file's existence passes, including
[`test-sibling-enforcement`](./test-sibling-enforcement.md), so the code it was meant to cover reads
as tested. This happened in a real repo, where a whole family of `.utils.test.ts` files sat unrun.

## What it flags

A test file (by default any `*.test.*` or `*.spec.*` source file) that sits under the directory of
at least one detected runner, while none of those runners collects it. The message lists what each
runner includes.

Runners are read from their configs without running them:

| Runner | Read from | What counts |
| --- | --- | --- |
| Vitest | `vitest.config.*`, `vitest.workspace.*`, `vite.config.*` with a `test` block | `test.include` (default `**/*.{test,spec}.?(c\|m)[jt]s?(x)`) under `test.root` / `test.dir`, minus literal `test.exclude` entries; inline `projects` each count as their own runner |
| Jest | `jest.config.*`, the `jest` key in a `package.json` | `testMatch` (default Jest's) or `testRegex`, under `rootDir`; inline `projects` |
| Bun | a `bun test` package script | Bun's file names (`*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`) under that package |
| Playwright | `playwright.config.*` | `testMatch` (default Playwright's) under `testDir`, minus literal `testIgnore` entries |

```ts
// apps/web/vitest.config.ts
export default defineConfig({ test: { include: ['src/**/*.test.tsx'] } });
// apps/web/src/format.utils.test.ts: reported, never collected
```

## What it does not flag

- **A file under a config the rule cannot read.** A value that is not written out as a literal (a
  variable, an imported base config, `mergeConfig(...)`, a `bun test` script with a path filter, a
  Playwright config whose projects move `testDir`) makes that runner unreadable, and files under it
  are left alone rather than guessed at.
- A test file under no runner at all, unless `requireRunner` is on.
- Files in `allowedFiles`, and anything under `node_modules`, `dist` and similar.

## Options

```ts
import { createTestFileMatchesRunnerIncludeRule } from '@noctcore/lint-meta-rules/typescript';

createTestFileMatchesRunnerIncludeRule(options?: TestFileMatchesRunnerIncludeOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `testFileGlobs` | `string[]` | `['**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']` | Files that are tests. |
| `detect` | `('vitest' \| 'jest' \| 'bun' \| 'playwright')[]` | all four | Runners to detect. |
| `runners` | `{ name, dir, include, exclude? }[]` | `[]` | Runner scopes declared by hand, added to the detected ones: a runner the rule does not know, or a config it cannot read. |
| `allowedFiles` | `string[]` | `[]` | Test files never reported. |
| `requireRunner` | `boolean` | `false` | Also report a test file no runner covers. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

When a config is too dynamic to read, declare what it collects:

```ts
createTestFileMatchesRunnerIncludeRule({
  runners: [{ name: 'vitest:web', dir: 'apps/web', include: ['src/**/*.test.{ts,tsx}'] }],
});
```

Needs the optional peer `typescript`.

## When not to use it

If every package runs its tests through one runner with its default include, nothing can fall
outside it, and the rule only costs time.
