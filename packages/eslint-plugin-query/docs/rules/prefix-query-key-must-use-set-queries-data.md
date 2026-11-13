# `noctcore-query/prefix-query-key-must-use-set-queries-data`

> `setQueryData(PREFIX, ...)` and `getQueryData(PREFIX)` miss every entry when the hooks key them as `[...PREFIX, id]`; use the prefix-matching `setQueriesData` / `getQueriesData`.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💡 Offers editor suggestions · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`setQueryData` and `getQueryData` address one exact key. When a hook builds its key as
`[...TODOS, id]`, the call `setQueryData(TODOS, list)` addresses the entry `TODOS`, which no hook
reads: the write lands in a cache slot nothing observes, and `getQueryData(TODOS)` returns
`undefined`. Types pass and the screen simply does not update. `setQueriesData` and
`getQueriesData` take a filter and match every key that starts with the prefix.

```ts bad
useQuery({ queryKey: [...TODOS, id], queryFn: () => api.todo(id) });
queryClient.setQueryData(TODOS, list);
```

```ts good
useQuery({ queryKey: [...TODOS, id], queryFn: () => api.todo(id) });
queryClient.setQueriesData({ queryKey: TODOS }, updater);
```

## What it flags

In a file where `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery` or
`queryOptions` has a `queryKey` of the form `[...PREFIX, extra]` (PREFIX an identifier or a
non-computed member chain, with at least one element after the spread), a member call
`<client>.setQueryData(PREFIX, ...)` or `<client>.getQueryData(PREFIX)` whose first argument has the
same source text as PREFIX. The call may come before or after the hook.

```ts bad
const options = queryOptions({ queryKey: [...keys.todos, filter], queryFn });
client.getQueryData(keys.todos);
```

Each report carries an ESLint suggestion, never an autofix: `setQueryData(PREFIX, a, b)` becomes
`setQueriesData({ queryKey: PREFIX }, a, b)` and `getQueryData(PREFIX)` becomes
`getQueriesData({ queryKey: PREFIX })`. `getQueriesData` returns `[queryKey, data]` pairs, so the
caller needs adjusting after the suggestion is applied. A method added through `methods` with no
known plural form is reported without a suggestion.

## What it does not flag

- A file where the bare PREFIX is itself the `queryKey` of one of those hooks. A list query beside its
  detail queries makes `setQueryData(TODOS, list)` correct.
- A full key such as `setQueryData([...TODOS, id], data)`, and a prefix no hook in the file spreads.
- The filter methods `cancelQueries`, `removeQueries`, `resetQueries` and `invalidateQueries`, which
  match by prefix on purpose, and `setQueriesData` / `getQueriesData`.

```ts good
useQuery({ queryKey: TODOS, queryFn: api.todos });
useQuery({ queryKey: [...TODOS, id], queryFn: () => api.todo(id) });
queryClient.setQueryData(TODOS, list);
queryClient.cancelQueries({ queryKey: TODOS });
```

### Limits

- The analysis is per file: a prefix that hooks in another file use as a bare key is not seen, so the
  exact-key call is reported here even though it is right.
- It is lexical: a key built in a variable first, a key from a factory call such as
  `todoKeys.all()`, and the callback of `useQueries({ queries: ids.map(...) })` are not read.
- `getQueriesData` returns `[queryKey, data]` pairs, so its suggestion needs the caller adjusted.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `methods` | `string[]` | `['setQueryData', 'getQueryData']` | Exact-key methods to check. Replaces the default list. |
| `queryHooks` | `string[]` | none | Extra hook names whose `queryKey` declares a query, added to the default hooks. |

```js
'noctcore-query/prefix-query-key-must-use-set-queries-data': [
  'error',
  { methods: ['setQueryData'], queryHooks: ['useApiQuery'] },
]
```

## When not to use it

Leave it off if the hooks that read a bare prefix key live in other files than the calls that write
it, since the rule cannot see across files.
