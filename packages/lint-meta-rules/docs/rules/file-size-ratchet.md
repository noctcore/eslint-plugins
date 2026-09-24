# `file-size-ratchet`

> Source files stay at or under a line cap, with a one-way, self-tightening baseline ratchet.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createFileSizeRatchetRule` from `@noctcore/lint-meta-rules` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

One factory covers every capped area: create one instance per area (an app's `src`, a package's
`src`), each with its own roots, extensions, exclusions and `id`. The `id` names both the rule and its
committed baseline file.

## Why

Nothing else caps whole-file size, and per-file escape hatches (e.g. ESLint counting only *exported*
hooks) let mega-files slip through. A ratchet freezes today's offenders and forbids growth: legacy
files may only shrink, and new files may never join. It does not force a refactor now — it stops the
debt from growing, and captures paydowns as they happen.

## What it flags

Measured in raw physical lines (`wc -l` semantics). Against a committed baseline at
`<baselineDir>/<id>.json`:

- a **new** over-cap file (not in the baseline), or a baselined one that **grew** past its frozen
  count — a live violation;
- **self-tightening**: a baseline entry whose file is gone, is now at/under the cap, or shrank far
  below its frozen value (`< frozen * tightenRatio`) is itself a violation demanding a baseline update.

The rule implements `baseline(ctx)` (the `IMetaRule` ratchet hook), which snapshots the current
offender map so the runner can regenerate the frozen file.

## What it does not flag

- A file at or under `cap`.
- A baselined file still within its frozen count: it is **grandfathered** (a stderr notice, no
  violation). One that shrank only a little (still at or above `frozen * tightenRatio`) stays
  grandfathered too.
- Paths containing an `excludeContains` fragment (tests, specs, stories by default) or starting with an
  `excludePrefixes` entry, and files whose extension is not in `extensions`.
- Anything at all when `roots` is empty: the rule is inert until you name a root.

## Options

```ts
createFileSizeRatchetRule(options?: FileSizeRatchetOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'file-size-ratchet'` | Rule id **and** baseline file basename — give each instance a distinct id. |
| `roots` | `string[]` | `[]` | Source roots to scan (**empty is inert**), e.g. `['apps/web/src']`. |
| `extensions` | `string[]` | `['.ts', '.tsx']` | File extensions to include. |
| `cap` | `number` | `400` | The per-file line cap. |
| `excludeContains` | `string[]` | `['.test.', '.spec.', '.stories.']` | Exclude paths containing any of these. |
| `excludePrefixes` | `string[]` | `[]` | Exclude paths starting with any of these (e.g. codegen dirs). |
| `tightenRatio` | `number` | `0.85` | A baseline entry below `frozen * ratio` must be re-frozen. |
| `baselineDir` | `string` | `.nightcore/lint-meta/baselines` | Where committed baselines live (from `@noctcore/harness`). |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

### Example: two capped areas

```ts
createFileSizeRatchetRule({
  id: 'web-file-size-ratchet',
  roots: ['apps/web/src'],
  extensions: ['.ts', '.tsx'],
  excludeContains: ['.test.', '.stories.', '__screenshots__'],
  excludePrefixes: ['apps/web/src/lib/generated/'],
});

createFileSizeRatchetRule({
  id: 'engine-file-size-ratchet',
  roots: ['packages/engine/src'],
  extensions: ['.ts'],
});
```

## When not to use it

If you have no over-cap files and no desire to cap file size, skip it. If you want a hard cap with no
grandfathering, commit an empty baseline — every over-cap file then fails immediately.
