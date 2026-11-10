# `noctcore-react/enforce-context-consumption`

> A prop whose value a registered scoped context already supplies must be read from the context, not declared or destructured as a prop again.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Replacing a drilled bundle of props with a scoped context is a refactor that quietly unwinds. The
next component that needs `onDelete` takes it as a prop, its parent threads it down from the
context consumer above, and a few changes later the drilling is back with the context alongside it.
Nothing fails: both paths deliver the same function.

This rule keeps the refactor done. You register each context once, with the files it applies to
and the prop names it supplies; in those files, a props contract that declares one of those names
again is reported.

```tsx bad options={"contexts":[{"hook":"useTaskActions","files":["**/board/**"],"providedProps":["onRun","onDelete"]}]} filename=src/board/TaskCard.tsx
// onRun is supplied by the board's TaskActions context
interface TaskCardProps {
  task: Task;
  onRun: (id: string) => void;
}
```

```tsx good options={"contexts":[{"hook":"useTaskActions","files":["**/board/**"],"providedProps":["onRun","onDelete"]}]} filename=src/board/TaskCard.tsx
// the card reads the action from the context instead
interface TaskCardProps {
  task: Task;
}
```

## What it flags

In a file matched by a registered context's `files`, a name from that context's `providedProps`:

- as a member of an interface or object type alias whose name ends in `Props`
  (`interface TaskCardProps { onRun: ... }`, `type RowProps = { onRun(): void }`);
- as a property destructured from a function's first parameter, when that parameter is annotated
  with a `*Props` type reference (`function TaskCard({ onRun }: TaskCardProps)`), in any function
  form.

The message names the hook to read the context with. When two entries supply the same name for a
file, the first entry is named.

```tsx bad reports=2 options={"contexts":[{"hook":"useBoardChrome","files":["**/board/**"],"providedProps":["autoMode","concurrency"]}]} filename=src/board/Column.tsx
// both values come from the board chrome context
export const Column = ({ autoMode, concurrency, title }: ColumnProps) => (
  <ColumnHeader title={title} autoMode={autoMode} concurrency={concurrency} />
);
```

```tsx good options={"contexts":[{"hook":"useBoardChrome","files":["**/board/**"],"providedProps":["autoMode","concurrency"]}]} filename=src/board/Column.tsx
// the header reads them itself
export const Column = ({ title }: ColumnProps) => <ColumnHeader title={title} />;
```

## What it does not flag

- Anything, when `contexts` is empty: the registry is the whole signal.
- Files outside an entry's `files`. The composition root that renders the provider should not match.
- A type whose name does not end in `Props`, such as the context's own value type.
- A parameter that is not annotated with a `*Props` type, a computed key, and members brought in
  through an intersection (`type RowProps = BaseProps & {...}`): only literal members are read.

A reusable leaf that legitimately takes one of the names as a prop (a generic button with
`onSelect`) is the case to plan for. Either leave that name out of `providedProps`, or keep such
leaves out of the entry's `files` (or your config block's `ignores`).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `contexts` | `{ hook, files, providedProps }[]` | `[]` | The registered contexts. |
| `contexts[].hook` | `string` | required | The hook that reads the context, named in the message. |
| `contexts[].files` | `string[]` (globs) | required | Files where the context is available. |
| `contexts[].providedProps` | `string[]` | required | The prop names the context supplies. |

```js
'noctcore-react/enforce-context-consumption': ['error', {
  contexts: [
    {
      hook: 'useTaskActions',
      files: ['src/components/board/**'],
      providedProps: ['onRun', 'onCancel', 'onDelete', 'onMerge'],
    },
    {
      hook: 'useWorktreesContext',
      files: ['src/components/board/**'],
      providedProps: ['worktrees', 'activeWorktree'],
    },
  ],
}]
```

## When not to use it

Without a scoped context that replaced drilled props, there is nothing to register. For general
drilling, see `no-prop-drilling`.

## Related

- [`no-prop-drilling`](./no-prop-drilling.md) reports props forwarded unchanged to a child; this rule
  reports a prop that a known context already supplies, forwarded or not.
