# `noctcore-architecture/index-must-reexport-default`

> A component folder's `index.ts` must re-export the sibling default named after the folder.

<!-- begin generated rule header -->
☑️ In `strict` at `error`, not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

When a component folder's `index.ts` re-exports the component default, consumers import the folder
(`import Card from '@/components/Card'`) rather than reaching for the inner file
(`.../Card/Card`). The barrel becomes the folder's single public entry point, and the internal file
layout stays free to change.

## What it flags

The rule only activates for an `index.ts` that sits next to a `<Folder>.tsx` of the same PascalCase
name on disk (`Card/Card.tsx` beside `Card/index.ts`). For those barrels, it reports when the file
never re-exports the sibling's default export.

```ts prose reason="the rule only runs when a sibling Card.tsx exists on disk"
// Card/index.ts

export { default as Card } from './Card'; // ✓
export { default } from './Card';         // ✓
export * from './Card.types';             // ✗ (on its own — no default re-export)
```

## What it does not flag

- Non-component `index.ts` files — those whose folder is not PascalCase, or that have no
  `<Folder>.tsx` sibling on disk.
- Files other than `index.ts`, such as `Card/Card.helpers.ts`.
- A barrel that re-exports the default in either form, alongside any other re-exports.
- Paths matched by `allowIn`.

### Edits to other files

This rule also reads the folder's listing, so its result can change when that file does.
`eslint --cache` does not notice and keeps the old result until the linted file itself changes. A
long-running editor server picks up an edit to it, because the rule re-reads it when it changes. See
[Rules that read other files](https://noctcore.github.io/eslint-plugins/filesystem-rules/).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` | `[]` | Globs (supporting `**`, `*`, `?`) of paths to skip. |
| `ignorePaths` | `string[]` | (none) | Deprecated alias of `allowIn`, kept through 1.x. When both are set, their globs are combined. |

```js
'noctcore-architecture/index-must-reexport-default': ['error', {
  allowIn: ['**/ui/**'],
}]
```

## When not to use it

If you do not use barrel files, or you export components as named (not default) exports, this rule
does not apply.
