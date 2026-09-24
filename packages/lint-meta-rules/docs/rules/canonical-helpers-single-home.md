# `canonical-helpers-single-home`

> A helper symbol must not be exported from two different helper homes.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createCanonicalHelpersSingleHomeRule` from `@noctcore/lint-meta-rules` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

When the same helper name is exported from multiple files, callers import inconsistent copies and the
implementations drift. Keeping each helper in one canonical home makes "where does `slug` live?"
unambiguous and prevents silent divergence.

## What it flags

Scans the files matched by `include` (minus any path containing an `excludeContains` fragment),
extracts top-level exported identifiers (from `export function|const|let|var …` and `export { … }`
lists — keyed on the **local** name before any `as`), and flags any name that appears as an export in
more than one file. Strict, no baseline.

## What it does not flag

- A name exported from only one helper home, however many files import it.
- An `export { x as y }` alias under a new public name: the check keys on the local name `x`.
- Files outside `include`, and any path containing an `excludeContains` fragment (`/lib/` by default).
- `export default`, `export class`, `export type` and `export interface` declarations: only
  `function`, `const`, `let`, `var` declarations and `export { … }` lists are read.

## Options

```ts
createCanonicalHelpersSingleHomeRule(options?: CanonicalHelpersSingleHomeOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` | `['apps/web/src/**/*.utils.ts']` | Helper-home files to scan for duplicate exports. |
| `excludeContains` | `string[]` | `['/lib/']` | Drop any matched path containing one of these fragments. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your project intentionally re-exports the same symbol from several modules (barrels, façades), scope
`include` to just the canonical-home files or skip the rule.
