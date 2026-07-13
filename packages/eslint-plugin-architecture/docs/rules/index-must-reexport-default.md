# `noctcore-architecture/index-must-reexport-default`

> A component folder's `index.ts` must re-export the sibling default named after the folder.

## Why

When a component folder's `index.ts` re-exports the component default, consumers import the folder
(`import Card from '@/components/Card'`) rather than reaching for the inner file
(`.../Card/Card`). The barrel becomes the folder's single public entry point, and the internal file
layout stays free to change.

## What it flags

The rule only activates for an `index.ts` that sits next to a `<Folder>.tsx` of the same PascalCase
name on disk (`Card/Card.tsx` beside `Card/index.ts`). For those barrels, it reports when the file
never re-exports the sibling's default export.

```ts
// Card/index.ts

export { default as Card } from './Card'; // ✓
export { default } from './Card';         // ✓
export * from './Card.types';             // ✗ (on its own — no default re-export)
```

Non-component `index.ts` files — those whose folder is not PascalCase, or that have no
`<Folder>.tsx` sibling on disk — are left untouched.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ignorePaths` | `string[]` | `[]` | Globs (supporting `**`, `*`, `?`) of paths to skip. |

```js
'noctcore-architecture/index-must-reexport-default': ['error', {
  ignorePaths: ['**/ui/**'],
}]
```

## When not to use it

If you do not use barrel files, or you export components as named (not default) exports, this rule
does not apply.
