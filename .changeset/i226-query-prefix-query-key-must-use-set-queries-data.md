---
'@noctcore/eslint-plugin-query': minor
---

Add the opt-in `prefix-query-key-must-use-set-queries-data` rule. In a file where a query hook (`useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery` or `queryOptions`) builds its key as `[...PREFIX, extra]`, it reports `setQueryData(PREFIX, ...)` and `getQueryData(PREFIX)`, which address an exact key no hook reads, and suggests `setQueriesData` / `getQueriesData`. The rule stays silent when the bare `PREFIX` is itself the `queryKey` of a hook in the file, and it never reports `cancelQueries`, `removeQueries`, `resetQueries` or `invalidateQueries`. The analysis is per file and lexical, which the rule doc states. `methods` replaces the default exact-key methods and `queryHooks` adds hook names.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. Enable it with `'noctcore-query/prefix-query-key-must-use-set-queries-data': 'error'`.
