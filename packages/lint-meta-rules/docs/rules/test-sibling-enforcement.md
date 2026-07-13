# `test-sibling-enforcement`

> Every source file matched by `include` must have a colocated sibling test.

## Why

A pure helper with no test is a silent liability — the kind of code that drifts because nothing pins
its behavior. Requiring a colocated test for a chosen class of files (nightcore's `.utils.ts` sidecars)
makes "did you test this?" a mechanical check rather than a review-time hope.

## What it flags

For each file matched by an `include` glob, the sibling test is the same path with its `.ts`/`.tsx`
extension replaced by each configured test extension. If none of those siblings exists, the source
file is flagged. Strict — there is no baseline; the pattern is opt-in via which files `include` selects.

## Factory

```ts
createTestSiblingEnforcementRule(options?: TestSiblingEnforcementOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` | `['apps/web/src/**/*.utils.ts']` | Source files that must ship a colocated test. |
| `testExtensions` | `string[]` | `['.test.ts', '.test.tsx']` | Accepted colocated-test extensions (replace the source extension). |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `apps/web/src/**/*.utils.ts` and the `.utils.test.ts(x)`
sibling shape.

## When not to use it

If you colocate tests loosely or centralize them in a `__tests__` tree, retune `include`/`testExtensions`
or skip the rule.
