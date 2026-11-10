# `noctcore-query/trpc-invalidate-with-path-key`

> Invalidate a tRPC procedure with `pathKey()`, not an input-less `queryKey()`, so infinite queries are reached too.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 🔧 Fixable with `--fix` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

With tRPC's TanStack Query integration, `trpc.post.list.queryKey()` without an input is
`[path, { type: 'query' }]`. An infinite query of the same procedure is keyed
`[path, { input, type: 'infinite' }]`, and TanStack's partial matching compares the `type` field
too, so this invalidation reaches every plain `list` query and no infinite one:

```ts bad
await queryClient.invalidateQueries({ queryKey: trpc.post.list.queryKey() });
```

It works today, while the list is a plain `useQuery`. The day the list moves to
`useInfiniteQuery`, the call goes dead: the mutation succeeds, the row on screen never changes,
and unit tests that mock the client keep passing. `pathKey()` is `[path]`, which matches every
entry of the procedure, plain and infinite:

```ts good
await queryClient.invalidateQueries({ queryKey: trpc.post.list.pathKey() });
```

For a plain query the two keys match the same entries, so the swap changes nothing until it matters.

## What it flags

An input-less `<root>...queryKey()` as the `queryKey` of a filter, or an input-less
`<root>...queryFilter()` as the whole filter, passed to `invalidateQueries`, `refetchQueries`,
`cancelQueries`, `removeQueries` or `resetQueries` on any receiver (an imported `sharedQueryClient`
counts):

```ts bad
await Promise.all([
  queryClient.invalidateQueries({ queryKey: trpc.invoice.list.queryKey() }),
  queryClient.refetchQueries(trpc.invoice.counts.queryFilter()),
]);
```

```ts good
await Promise.all([
  queryClient.invalidateQueries({ queryKey: trpc.invoice.list.pathKey() }),
  queryClient.refetchQueries(trpc.invoice.counts.pathFilter()),
]);
```

### Autofix

`--fix` renames `queryKey` to `pathKey` and `queryFilter` to `pathFilter`. Nothing else in the
call changes.

## What it does not flag

- A key with an input, `queryKey({ id })`, `queryKey({})` included: it addresses exact entries on
  purpose.
- A filter that also sets `exact`: `exact: true` against `[path]` would match nothing, so the swap
  would not be equivalent.
- `setQueryData` and `getQueryData`, which address one entry.
- A key built in a variable first, or a proxy reached through `this.` or a call: the check is
  lexical.

```ts good
queryClient.setQueryData(trpc.post.list.queryKey(), next);
await queryClient.invalidateQueries({ queryKey: trpc.post.byId.queryKey({ id }) });
await queryClient.invalidateQueries({ queryKey: trpc.post.list.queryKey(), exact: true });
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `methods` | `string[]` | `['invalidateQueries', 'refetchQueries', 'cancelQueries', 'removeQueries', 'resetQueries']` | QueryClient methods whose filter is checked. |
| `rootIdentifiers` | `string[]` | `['trpc']` | Identifiers that hold the tRPC options proxy. |

```js
'noctcore-query/trpc-invalidate-with-path-key': ['error', { rootIdentifiers: ['trpc', 'api'] }]
```

## When not to use it

If you use tRPC's classic React integration (`utils.post.list.invalidate()`), there is no
`queryKey()` call to check and the rule stays silent. Leave it on anyway if a migration to the
TanStack integration is planned.
