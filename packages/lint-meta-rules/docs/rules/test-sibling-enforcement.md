# `test-sibling-enforcement`

> Every source file matched by `include` must have a colocated sibling test.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTestSiblingEnforcementRule` from `@noctcore/lint-meta-rules` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A pure helper with no test is a silent liability — the kind of code that drifts because nothing pins
its behavior. Requiring a colocated test for a chosen class of files (`.utils.ts` helper files, say)
makes "did you test this?" a mechanical check rather than a review-time hope.

## What it flags

For each file matched by an `include` glob, the sibling test is the same path with its `.ts`/`.tsx`
extension replaced by each configured test extension. If none of those siblings exists, the source
file is flagged. Strict — there is no baseline; the pattern is opt-in via which files `include` selects.

## What it does not flag

- A matched file with a sibling for any one of `testExtensions` (`foo.utils.test.ts` or
  `foo.utils.test.tsx` for `foo.utils.ts`).
- Files outside `include` (only `apps/web/src/**/*.utils.ts` by default).

## Options

```ts
createTestSiblingEnforcementRule(options?: TestSiblingEnforcementOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` | `['apps/web/src/**/*.utils.ts']` | Source files that must ship a colocated test. |
| `testExtensions` | `string[]` | `['.test.ts', '.test.tsx']` | Accepted colocated-test extensions (replace the source extension). |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If you colocate tests loosely or centralize them in a `__tests__` tree, retune `include`/`testExtensions`
or skip the rule.
