# `noctcore-contracts/wire-message-naming`

> A message-schema's `type` discriminant must be the kebab-case of its const name minus its role suffix. 🔧

## Why

When wire messages are modelled as zod objects with a `type: z.literal('…')` discriminant, the const
name and the on-the-wire discriminant are two spellings of the same fact. Deriving one from the other
by convention (`TaskCompletedEvent` ⇒ `'task-completed'`) removes a whole class of copy-paste
drift where the const is renamed but the literal is not.

## What it flags

For every `export const` whose name ends in a role suffix (default `Event` / `Command` / `Query`) and
whose zod object declares a `type: z.literal('…')` property, the literal must equal
`kebab(constName minus the role suffix)`. A mismatch is reported and **autofixed** to the expected
value.

```ts
// ✗ camelCase discriminant  →  autofixes to 'task-completed'
export const TaskCompletedEvent = z.object({ type: z.literal('taskCompleted') });

// ✗ wrong value              →  autofixes to 'run-task'
export const RunTaskCommand = z.object({ type: z.literal('run') });

// ✓
export const TaskCompletedEvent = z.object({ type: z.literal('task-completed') });
```

Consts without a role suffix, and role-suffixed consts without a `type` literal, are ignored.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `roleSuffixes` | `string[]` | `['Event', 'Command', 'Query']` | Const-name suffixes that mark a schema as a wire message. |

```js
'noctcore-contracts/wire-message-naming': ['error', { roleSuffixes: ['Message'] }]
```

```ts
// with roleSuffixes: ['Message']  →  autofixes to 'task-done'
export const TaskDoneMessage = z.object({ type: z.literal('done') });
```

## When not to use it

If your messages do not carry a role-suffixed const name plus a `type: z.literal(...)` discriminant,
this rule never fires. Pair it with [`zod-schema-naming`](./zod-schema-naming.md) (listing the same
suffixes there) so every export is covered by exactly one naming contract.
