# `test-files-require-source-sibling`

> Every colocated test file must sit next to the source it covers: a same-named source file, or a directory module's index.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTestFilesRequireSourceSiblingRule` from `@noctcore/lint-meta-rules` · Category `testing` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A test left behind after its source moved or was deleted still runs and still passes, so it reads as
coverage of code that is gone or lives somewhere else. Requiring every colocated test to sit beside the
file it covers turns "what does this test cover?" into a mechanical check. It is the complement of
[`test-sibling-enforcement`](./test-sibling-enforcement.md), which asks the reverse: every chosen source
file has a test.

### Opt-in

The rule is in `RULE_FACTORIES` and in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` skips it. Code
that iterates `RULE_FACTORIES` or `RULE_IDS` itself does build it, at `ciCritical: true`: filter out
`OPT_IN_RULE_IDS` there if you do not want it. Enable it by naming it in `optIn`, or by calling its factory:

```ts prose
import { createAllRules, createTestFilesRequireSourceSiblingRule } from '@noctcore/lint-meta-rules';

const everything = createAllRules({ optIn: ['test-files-require-source-sibling'] });
const justThisOne = createTestFilesRequireSourceSiblingRule({ roots: ['packages/*/src'] });
```

## What it flags

A test under one of `roots` (a file whose name ends in one of `testSuffixes`) whose base name, the path
with the longest matching suffix removed, has no source with any of `sourceExtensions` beside it and,
with `directoryModules`, no `<base>/index<ext>` either. The message names every candidate it looked for.

```text
src/a/Orphan.test.ts        reported: no src/a/Orphan.ts, .tsx, .mts, .cts, .js, nor src/a/Orphan/index.*
src/Button.test.tsx         reported when src/Button/ holds no index.<ext>
```

## What it does not flag

- A test beside its source with any listed extension (`Kept.test.tsx` next to `Kept.ts`, or a test next
  to a `.mts`, `.cts` or `.js` file).
- A test beside a directory module (`Button.test.tsx` next to `Button/index.tsx`), unless
  `directoryModules` is `false`. A folder with no `index.<ext>` is not a directory module.
- Tests outside every entry of `roots` (only `src` by default), and anything under `node_modules`,
  `dist`, `.git`, `.turbo` or `coverage`.
- Files whose name ends in a suffix that is not in `testSuffixes` (`.spec.ts` by default).
- Tests matched by an `ignore` glob.

## Options

```ts
createTestFilesRequireSourceSiblingRule(options?: TestFilesRequireSourceSiblingOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `roots` | `string[]` | `['src']` | Directories searched for tests. Globs work, such as `packages/*/src` in a monorepo. |
| `testSuffixes` | `string[]` | `['.test.ts', '.test.tsx']` | Name suffixes that mark a test. The longest one a file ends with is removed to get the source base. |
| `sourceExtensions` | `string[]` | `['.ts', '.tsx', '.mts', '.cts', '.js']` | Extensions a covered source may have. |
| `ignore` | `string[]` | `[]` | Globs over the repo-relative test path; a matching test is skipped. |
| `directoryModules` | `boolean` | `true` | Whether `<base>/index<ext>` counts as the source. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your tests live in a `__tests__` tree or a separate `test/` folder rather than beside the code, list
those folders in `ignore` or skip the rule: a `__tests__` folder gets no special treatment. A test that
covers several modules on purpose (an integration test kept under `src`) has no single sibling; list it in
`ignore`.

## Related

- [`test-sibling-enforcement`](./test-sibling-enforcement.md): every chosen source file has a colocated test.
- [`test-file-matches-runner-include`](./test-file-matches-runner-include.md): every test file is collected by a runner.
