# `noctcore-architecture/component-folder-structure`

> A component entry file must ship its full sibling set (hooks, types, story, test, barrel) on disk.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

In a folder-per-component layout, a component is a folder — not a lone `.tsx`. When the logic
(`.hooks.ts`), the types (`.types.ts`), the story (`.stories.tsx`), the test (`.test.tsx`), and the
`index.ts` barrel always travel with the component, refactors stay local and nothing is quietly
untested or undocumented. This rule enforces that colocation by construction.

A purely presentational component has no logic to extract, and its `.hooks.ts` ends up as an
`export {};` with a comment. That is the cost of the convention, and it is deliberate: the file
being present means there is one obvious place for logic to go the day the component grows some,
and a reviewer never has to ask where it lives. A project that disagrees drops `.hooks.ts` from
`requiredSiblings` rather than carrying stub files.

## What it flags

For every **component entry file** — a PascalCase `.tsx` whose basename equals its parent folder
(`TaskCard/TaskCard.tsx`) — that lives under the configured `componentRoot`, the rule reads the
component's directory and reports any sibling from the required set that is missing on disk.

```text prose reason="the rule checks for sibling files on disk"
components/board/TaskCard/
  TaskCard.tsx          ← entry file (checked)
  TaskCard.hooks.ts     ┐
  TaskCard.types.ts     │ required siblings
  TaskCard.stories.tsx  │ (missing → reported)
  TaskCard.test.tsx     │
  index.ts              ┘
```

## What it does not flag

- Files that are not entry files: `task-card.tsx` (not PascalCase) or `Group/Widget.tsx` (basename
  differs from its folder).
- Entry files outside the `componentRoot` segment, such as `routes/Widget/Widget.tsx`.
- Files matched by `ignorePaths`; the default `**/ui/**` keeps the lighter shadcn-style layout.
- A component folder whose siblings cover whatever `requiredSiblings` is set to, even a trimmed set.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `componentRoot` | `string` | `'components'` | The directory segment the layout is anchored on. |
| `requiredSiblings` | `string[]` | `['.hooks.ts', '.types.ts', '.stories.tsx', '.test.tsx', 'index.ts']` | The sibling set. An entry starting with `.` is a name-relative suffix (`.hooks.ts` → `<Name>.hooks.ts`); any other entry is a literal filename (`index.ts`). |
| `ignorePaths` | `string[]` | `['**/ui/**']` | Globs (supporting `**`, `*`, `?`) of paths to skip. |

```js
'noctcore-architecture/component-folder-structure': ['error', {
  componentRoot: 'components',
  requiredSiblings: ['.hooks.ts', '.types.ts', '.stories.tsx', '.test.tsx', 'index.ts'],
  ignorePaths: ['**/ui/**'],
}]
```

## When not to use it

If your components are single files rather than folders, or you do not colocate stories/tests with
components, disable this rule or trim `requiredSiblings` to just the pieces you do colocate.
