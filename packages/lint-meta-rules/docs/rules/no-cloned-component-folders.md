# `no-cloned-component-folders`

> A component folder name may exist under only one feature.

## Why

Same-named component folders across features are how sibling drift starts: a component cloned into a
second feature diverges silently until the two are subtly incompatible. A genuinely shared surface
belongs in a shared destination (e.g. `components/ui`); a genuinely different one deserves a name that
says so.

## What it flags

A `<feature>/<Name>/<barrelFile>` path marks a component folder. Grouping by `<Name>` across features
(excluding `excludedFeatures`), any name appearing under two or more features — and not in
`allowedClones` — is flagged. The allowlist freezes today's clone groups and only shrinks: an
`allowedClones` entry whose clone group no longer exists is itself flagged as stale.

## Factory

```ts
createNoClonedComponentFoldersRule(options?: NoClonedComponentFoldersOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `componentsRoot` | `string` | `'apps/web/src/components'` | Root under which `<feature>/<Component>/` folders live. |
| `barrelFile` | `string` | `'index.ts'` | Barrel file that marks a component folder. |
| `excludedFeatures` | `string[]` | `['ui', 'app']` | Feature folders whose contents are not feature components. |
| `allowedClones` | `string[]` | `[]` | Component names allowed to be cloned (a shrinking allowlist). |
| `sharedDest` | `string` | `'components/ui'` | Where a shared surface should be hoisted (used in the message). |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `apps/web/src/components`, the `ui`/`app` excluded
features, and a fixed `ALLOWED_CLONES` set.

## When not to use it

If your components are not organized as `<feature>/<Component>/` folders under one root, or you
intentionally maintain per-feature variants, retune or skip the rule.
