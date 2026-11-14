# `noctcore-query/query-fn-must-not-swallow-error`

> A `queryFn` rethrows its error instead of catching it and returning a fallback value.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A `queryFn` that catches its own error and returns `null`, `[]` or `{}` turns a failed request into
cached data. The query reports `success`, never reaches its error state, never retries, and the
screen shows an empty value as if the server had answered. The error boundary and the retry policy
never see the failure.

```ts bad
useQuery({
  queryKey: userKeys.me,
  queryFn: async () => {
    try {
      return await api.me();
    } catch {
      return null;
    }
  },
});
```

```ts good
useQuery({
  queryKey: userKeys.me,
  queryFn: async () => {
    try {
      return await api.me();
    } catch (e) {
      throw toAppError(e);
    }
  },
});
```

## What it flags

An inline function or arrow given as `queryFn` of `useQuery`, `useInfiniteQuery`,
`useSuspenseQuery`, `useSuspenseInfiniteQuery` or `queryOptions`, and of each element of
`useQueries({ queries: [...] })`, with either of:

- a `return <value>` inside a `catch` clause, including `[]`, `{}` and the caught error itself;
- a `.catch(() => value)` or `.catch((e) => { return value; })` on the promise it returns, as a
  concise arrow body or as the argument of a `return`.

```ts bad
useQuery({ queryKey: userKeys.list, queryFn: () => api.list().catch(() => []) });
```

```ts bad
useQuery({
  queryKey: userKeys.list,
  queryFn: async () => {
    try {
      return await api.list();
    } catch (e) {
      if (isOffline(e)) return [];
      throw e;
    }
  },
});
```

```ts bad
useQueries({
  queries: [
    { queryKey: userKeys.me, queryFn: api.me },
    { queryKey: teamKeys.me, queryFn: () => api.team().catch((e) => { return {}; }) },
  ],
});
```

## What it does not flag

A catch that throws on every path, a catch that logs and rethrows, a bare `return;` or
`return undefined`, `return Promise.reject(...)`, a `.catch` handler that throws or returns
`Promise.reject(...)`, a return inside a function nested in the catch, and the same code under a
property that is not in `queryFnProperties`.

```ts good
useQuery({
  queryKey: userKeys.me,
  queryFn: async () => {
    try {
      return await api.me();
    } catch (e) {
      logger.error(e);
      throw e;
    }
  },
});
```

```ts good
useQuery({ queryKey: userKeys.me, queryFn: () => api.me().catch((e) => Promise.reject(toAppError(e))) });
```

The check is lexical and stays inside the inline function. It does not follow:

- a `queryFn` given by name (`queryFn: fetchMe`) or as a member;
- a try/catch in a helper the `queryFn` calls;
- `useQueries({ queries: ids.map(...) })`, where the elements are built by a callback;
- a `.catch` result stored in a variable before it is returned, or a `.catch` that is not the
  outermost call of the returned expression (`.catch(...).then(...)`);
- `.then(ok, fail)` and client methods such as `fetchQuery`.

A fallback that is the real contract, such as `null` for an optional resource, is marked with a
`// allow-silent: <reason>` comment on the line directly above the reported `return` (or above the
`.catch` handler). The marker must be followed by a colon and a non-empty reason.

```ts good
useQuery({
  queryKey: profileKeys.me,
  queryFn: async () => {
    try {
      return await api.profile();
    } catch {
      // allow-silent: the profile is optional
      return null;
    }
  },
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowComment` | `string` | `allow-silent` | Marker text of the comment that allows a fallback, written `// <marker>: <reason>`. |
| `queryFnProperties` | `string[]` | `["queryFn"]` | Option keys whose inline function is checked. Replaces the default list; applies to the hooks, `queryOptions` and each `useQueries` element. |

```js
'noctcore-query/query-fn-must-not-swallow-error': [
  'error',
  { allowComment: 'swallow-ok', queryFnProperties: ['queryFn', 'loader'] },
]
```

## When not to use it

Leave it off if your queries return `null` or an empty list for optional resources as a rule: the
rule is opt-in for that reason, and a codebase that wants every fallback marked can turn it on and
add the comment where a fallback is intended.
