# `noctcore-architecture/no-cross-feature-imports`

> A file in one feature may not import runtime code from another feature.

## Why

Features are meant to be decoupled: a change inside feature `board` should never be able to ripple
into feature `projects`. When one feature reaches directly into another's internals, that boundary
erodes and the two become one tangled unit. Shared code belongs outside the feature root (a `lib`,
`hooks`, or similar module) or in a designated **shared feature** (default `ui`) that everything is
allowed to import.

## What it flags

For a file that lives under `<featureRoot>/<feature>/…`, the rule reports any import whose target
resolves to a **different** feature under the same root, on every source-carrying construct:

- static `import … from '…'`
- dynamic `import('…')`
- `export … from '…'` and `export * from '…'` re-export laundering

Both the alias form (`<alias>/<feature>/…`) and relative paths that climb into another feature
(`../../projects/…`) are detected. Type-only imports are allowed by default (flip `allowTypeImports`
to forbid them). Imports of the current feature, of a shared feature, or of non-feature modules are
always fine.

```tsx
// in components/board/Board/Board.tsx

import { Button } from '@/components/ui/Button';         // ✓ shared feature
import { cn } from '@/lib/utils';                        // ✓ non-feature module
import { TaskCard } from '../TaskCard/TaskCard';         // ✓ same feature
import { ProjectCard } from '@/components/projects/…';   // ✗ cross-feature
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `featureRoot` | `string` | `'components'` | The directory segment whose immediate children are features. |
| `alias` | `string` | `'@/components'` | The import-alias prefix that maps onto `featureRoot`. |
| `sharedFeatures` | `string[]` | `['ui']` | Features every other feature is allowed to import. |
| `allowTypeImports` | `boolean` | `true` | When `true`, `import type` / `export type` cross-feature imports are permitted. |

```js
'noctcore-architecture/no-cross-feature-imports': ['error', {
  featureRoot: 'components',
  alias: '@/components',
  sharedFeatures: ['ui'],
  allowTypeImports: true,
}]
```

## When not to use it

If your app is not organized as sibling features under a single root, or you allow features to
depend on each other freely, this rule does not apply.
