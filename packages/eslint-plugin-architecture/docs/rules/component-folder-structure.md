# `noctcore-architecture/component-folder-structure`

> A component entry file must ship its full sibling set (hooks, types, story, test, barrel) on disk.

## Why

In a folder-per-component layout, a component is a folder — not a lone `.tsx`. When the logic
(`.hooks.ts`), the types (`.types.ts`), the story (`.stories.tsx`), the test (`.test.tsx`), and the
`index.ts` barrel always travel with the component, refactors stay local and nothing is quietly
untested or undocumented. This rule enforces that colocation by construction.

## What it flags

For every **component entry file** — a PascalCase `.tsx` whose basename equals its parent folder
(`TaskCard/TaskCard.tsx`) — that lives under the configured `componentRoot`, the rule reads the
component's directory and reports any sibling from the required set that is missing on disk.

```
components/board/TaskCard/
  TaskCard.tsx          ← entry file (checked)
  TaskCard.hooks.ts     ┐
  TaskCard.types.ts     │ required siblings
  TaskCard.stories.tsx  │ (missing → reported)
  TaskCard.test.tsx     │
  index.ts              ┘
```

Files that are not entry files (`task-card.tsx`, `Group/Widget.tsx`), files outside the
`componentRoot`, and files matched by `ignorePaths` are never checked.

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
