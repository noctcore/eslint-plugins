# `noctcore-architecture/filename-matches-export`

> A file's basename must match its primary export (a default export, or the sole named export).

## Why

When a module has one clear public export, the filename should announce it. A `helpers.ts` that
exports a single `formatDate` hides its contents from anyone scanning the file tree, and a rename of
one without the other leaves the two permanently out of sync. Keeping them aligned makes the tree
self-describing.

## What it flags

The rule first resolves the file's **primary export**:

1. If the file has a default export with a name (`export default function Foo`, `export default
   class Foo`, `export default Foo`), that name is the primary export. An anonymous default
   (`export default () => …`) has no identifier to compare, so the file is skipped.
2. Otherwise, if the file has exactly one local named export, that is the primary export.
3. Otherwise (no primary, or several named exports) the file is skipped.

The basename and the identifier are compared **case- and separator-insensitively**, so naming
conventions never collide:

```ts
// TaskCard.tsx  → export default function TaskCard() {}   ✓
// use-thing.ts  → export const useThing = () => {}        ✓ (kebab ↔ camel)
// helpers.ts    → export const formatDate = () => {}      ✗ (genuine mismatch)
```

`index` files and files matching an `ignore` glob are always skipped.

## Suggestion, not autofix

A mismatch offers a **suggestion** to rename the export to the filename (the code-side resolution —
the other is renaming the file). It is never an autofix: renaming a public identifier is a decision a
human should confirm. When the basename is not a valid identifier (e.g. `2fa.ts`), the mismatch is
reported without a suggestion.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ignore` | `string[]` | `[]` | Globs (supporting `**`, `*`, `?`) of files to skip. |

```js
'noctcore-architecture/filename-matches-export': ['error', {
  ignore: ['**/*.stories.tsx', '**/route.ts'],
}]
```

## When not to use it

If your files routinely export several unrelated symbols, or you use fixed conventional filenames
(`route.ts`, `handler.ts`) that will never match their export, add them to `ignore` or leave the rule
off.
