---
'@noctcore/eslint-plugin-query': minor
---

Add the opt-in `query-fn-must-not-swallow-error` rule. It reports a `return <value>` inside a `catch` clause of an inline `queryFn`, and a `.catch(() => value)` handler that returns a value on the promise the `queryFn` returns, because either turns a failed request into cached data: the query reports success, never reaches its error state and never retries. It reads `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `queryOptions` and each element of `useQueries({ queries: [...] })`. A rethrow, `Promise.reject(...)`, a bare or `undefined` return, a return inside a nested function, and a `queryFn` given by name are left alone.

`allowComment` (default `allow-silent`) sets the escape marker: a `// allow-silent: <reason>` comment with a non-empty reason on the line directly above the reported node silences it. `queryFnProperties` (default `['queryFn']`) lists the option keys that are checked, and a configured list replaces the default rather than adding to it.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. Enable it with `'noctcore-query/query-fn-must-not-swallow-error': 'error'`.
