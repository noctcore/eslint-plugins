# `ui-primitive-shape`

> A folder primitive must ship its proof siblings; a flat primitive must carry none at the ui root.

## Why

The primitives root is the one place exempt from folder-per-component: flat single files are fine for
presentational primitives. But once a primitive graduates to its own folder, it is a real component
and must carry the same proof-of-behavior siblings (a test, a story) as any feature component. This
closes the "the ui folder mixes two shapes with no rule" gap: flat = pure presentational; folder =
tested + storied.

## What it flags

- **Folder primitives** — for each `<uiRoot>/<Name>/<barrelFile>`, each configured role must exist as
  `<Name>.<role><extension>`; a missing one is flagged.
- **Flat primitives** — a flat `<uiRoot>/<Name><extension>` (capitalized) that already has a sibling
  `<Name>.<role><extension>` at the ui root is flagged: those proof files belong inside a `<Name>/`
  folder.

## Factory

```ts
createUiPrimitiveShapeRule(options?: UiPrimitiveShapeOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `uiRoot` | `string` | `'apps/web/src/components/ui'` | The primitives root. |
| `barrelFile` | `string` | `'index.ts'` | Barrel file that marks a folder-primitive. |
| `roles` | `string[]` | `['test', 'stories']` | Proof-of-behavior sibling roles a folder-primitive must ship. |
| `extension` | `string` | `'.tsx'` | Extension of primitive and proof files. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `apps/web/src/components/ui`, the `test`/`stories` roles,
and the `.tsx` extension.

## When not to use it

If you do not maintain a flat-vs-folder primitive convention or do not colocate stories/tests, skip
the rule.
