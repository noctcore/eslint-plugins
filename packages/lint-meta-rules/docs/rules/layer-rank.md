# `layer-rank`

> A module may import only strictly-lower-ranked `<scope>` packages — equal (sideways) or higher
> (upward) is forbidden.

## Why

Layered architectures encode a fixed dependency direction (e.g. `contracts → shared → storage/skills
→ engine → surfaces`). Enforcing it mechanically keeps the spine acyclic: a low tier can never reach
up into a higher one, and co-tier packages never entangle. New edges that would violate the direction
are caught before they calcify.

## What it flags

Each source file is assigned an **importer rank**: surface files (matched by `surfacePrefix`) get
`surfaceRank`; otherwise the `packageDirPattern` capture is looked up in `ranks`. For each
`<scope>/<pkg>` import whose target is also ranked, the rule flags it when the target rank is `>=` the
importer rank (sideways when equal, upward when greater). Unranked importers and unranked targets are
skipped, so a package outside the documented spine never produces a false positive. Test files are
skipped.

## Factory

```ts
createLayerRankRule(options?: LayerRankOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | `string` | `'@nightcore'` | npm scope of workspace packages. |
| `ranks` | `Record<string,number>` | `{}` | Layer package name → rank. **Empty makes the rule inert** (opt-in). |
| `surfacePrefix` | `string` | `'apps/'` | Path prefix marking a deployable surface. |
| `surfaceRank` | `number` | `undefined` | Rank for surface files; omit to leave surfaces unranked. |
| `packageDirPattern` | `string` | `'^packages/([^/]+)/'` | Regex source extracting the layer name from a file path. |
| `sourceGlobs` | `string[]` | packages + apps `src/**` `.ts`/`.tsx` | Source files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded a fixed rank table and the `@nightcore` scope. `ranks`
defaults to `{}` so the rule is inert until a consumer supplies its own layering.

## When not to use it

If your codebase is not organized into ranked layers, leave `ranks` empty (the rule then does
nothing).
