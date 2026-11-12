# `noctcore-query/query-key-must-be-constant`

> Query and mutation keys come from a constant or a key factory, not an inline array that starts with a string.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A key typed inline is a string that has to stay identical everywhere the entry is read, written or
invalidated. Rename `'user'` in one hook and the `invalidateQueries({ queryKey: ['user'] })` that
still says `'user'` stops reaching it, with nothing failing: types pass and tests that mock the
client still pass. Keeping keys in one constant or key factory puts the rename in one place.

```ts bad
useQuery({ queryKey: ['user', id], queryFn: () => api.user(id) });
queryClient.invalidateQueries({ queryKey: ['user'] });
```

```ts good
useQuery({ queryKey: userKeys.detail(id), queryFn: () => api.user(id) });
queryClient.invalidateQueries({ queryKey: userKeys.all });
```

## What it flags

An inline array whose first element is a string or a template literal, in:

- `queryKey` or `mutationKey` of `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`,
  `useSuspenseInfiniteQuery`, `useMutation` and `queryOptions`;
- `queryKey` of each element of `useQueries({ queries: [...] })`;
- the filter object or the first argument of `invalidateQueries`, `setQueryData`, `removeQueries`,
  `getQueryData` and `prefetchQuery`.

```ts bad
useMutation({ mutationKey: ['user', 'save'], mutationFn: saveUser });
```

```ts bad
useQueries({ queries: [{ queryKey: USER, queryFn }, { queryKey: ['post', id], queryFn }] });
```

```ts bad
queryClient.setQueryData(['user', id], data);
```

## What it does not flag

An identifier or member (`USER_KEYS.me`), a factory call (`userKeys.detail(id)`), an array that
starts with a spread or any non-string first element, and the arrays inside a key factory
definition, which are not arguments of a hook or client call. The check is lexical: a key built in
a variable first, a tRPC `queryKey()` call and the callback of `useQueries({ queries: ids.map(...) })`
are not read.

```ts good
useQuery({ queryKey: USER_KEYS.me, queryFn });
useQuery({ queryKey: [...USER_KEYS.all, id], queryFn });
queryClient.invalidateQueries({ queryKey: trpc.post.list.pathKey() });
const userKeys = { all: ['user'] as const, detail: (id: string) => ['user', id] as const };
```

The positional form `setQueryData(['user', id], data)` is the TanStack Query v4 call style and a
type error in v5. It is checked so v4 code gets the same treatment.

Files matching `allowIn` are skipped. The default is test files, which build throwaway keys on
purpose.

```ts good filename=src/user.test.ts relocation
useQuery({ queryKey: ['user', id], queryFn });
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `keyHookNames` | `string[]` | none | Extra hook or factory names whose `queryKey` / `mutationKey` is checked, added to the defaults. |
| `clientMethodNames` | `string[]` | none | Extra client method names whose key is checked, added to the defaults. |
| `allowIn` | `string[]` | test files (`**/*.{spec,test}.*`, `**/__tests__/**`) | Globs of files where an inline key is allowed. Replaces the default list. |

```js
'noctcore-query/query-key-must-be-constant': [
  'error',
  { keyHookNames: ['useApiQuery'], clientMethodNames: ['fetchQuery'], allowIn: ['**/keys/**'] },
]
```

## When not to use it

Leave it off if your codebase keeps keys inline on purpose. A codebase whose single source of keys
is a module of `queryOptions(...)` factories defines its keys inside a matched call, so add that
module to `allowIn`.
