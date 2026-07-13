# `canonical-helpers-single-home`

> A helper symbol must not be exported from two different helper homes.

## Why

When the same helper name is exported from multiple files, callers import inconsistent copies and the
implementations drift. Keeping each helper in one canonical home makes "where does `slug` live?"
unambiguous and prevents silent divergence.

## What it flags

Scans the files matched by `include` (minus any path containing an `excludeContains` fragment),
extracts top-level exported identifiers (from `export function|const|let|var …` and `export { … }`
lists — keyed on the **local** name before any `as`), and flags any name that appears as an export in
more than one file. Strict, no baseline.

## Factory

```ts
createCanonicalHelpersSingleHomeRule(options?: CanonicalHelpersSingleHomeOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` | `['apps/web/src/**/*.utils.ts']` | Helper-home files to scan for duplicate exports. |
| `excludeContains` | `string[]` | `['/lib/']` | Drop any matched path containing one of these fragments. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `apps/web/src/**/*.utils.ts` and a `/lib/` exclusion.

## When not to use it

If your project intentionally re-exports the same symbol from several modules (barrels, façades), scope
`include` to just the canonical-home files or skip the rule.
