# `noctcore-architecture/component-folder-structure`

> A component entry file must ship its sibling set (types, story, test, barrel) on disk.

## Why

In a folder-per-component layout, a component is a folder — not a lone `.tsx`. When the types
(`.types.ts`), the story (`.stories.tsx`), the test (`.test.tsx`) and the `index.ts` barrel always
travel with the component, refactors stay local and nothing is quietly untested or undocumented.
This rule enforces that colocation by construction.

`.hooks.ts` is **not** in the default set, deliberately. Requiring it produces empty modules: a
component with no logic to extract gets a file containing `export {};` purely to satisfy the
linter, which teaches the opposite of what the rule is for. Projects that do want a hooks file
everywhere can add `.hooks.ts` to `requiredSiblings`.

## What it flags

For every **component entry file** — a PascalCase `.tsx` whose basename equals its parent folder
(`TaskCard/TaskCard.tsx`) — that lives under the configured `componentRoot`, the rule reads the
component's directory and reports any sibling from the required set that is missing on disk.

```text prose reason="the rule checks for sibling files on disk"
components/board/TaskCard/
  TaskCard.tsx          ← entry file (checked)
  TaskCard.types.ts     ┐
  TaskCard.stories.tsx  │ required siblings
  TaskCard.test.tsx     │ (missing → reported)
  index.ts              ┘
  TaskCard.hooks.ts     ← not required by default; add it to requiredSiblings if you want it
```

Files that are not entry files (`task-card.tsx`, `Group/Widget.tsx`), files outside the
`componentRoot`, and files matched by `ignorePaths` are never checked.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `componentRoot` | `string` | `'components'` | The directory segment the layout is anchored on. |
| `requiredSiblings` | `string[]` | `['.types.ts', '.stories.tsx', '.test.tsx', 'index.ts']` | The sibling set. An entry starting with `.` is a name-relative suffix (`.hooks.ts` → `<Name>.hooks.ts`); any other entry is a literal filename (`index.ts`). |
| `ignorePaths` | `string[]` | `['**/ui/**']` | Globs (supporting `**`, `*`, `?`) of paths to skip. |

```js
'noctcore-architecture/component-folder-structure': ['error', {
  componentRoot: 'components',
  requiredSiblings: ['.types.ts', '.stories.tsx', '.test.tsx', 'index.ts'],
  ignorePaths: ['**/ui/**'],
}]
```

## When not to use it

If your components are single files rather than folders, or you do not colocate stories/tests with
components, disable this rule or trim `requiredSiblings` to just the pieces you do colocate.
