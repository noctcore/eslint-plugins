---
'@noctcore/eslint-plugin-query': minor
---

Add the opt-in rule `query-key-must-be-constant`. It flags an inline key array that starts with a string or template literal, in the `queryKey` or `mutationKey` of `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `queryOptions` and each element of `useQueries({ queries })`, and in `invalidateQueries`, `setQueryData`, `removeQueries`, `getQueryData` and `prefetchQuery`, both as a filter object and as a positional first argument. Constants, key factory calls, arrays that start with a spread and test files are left alone; `keyHookNames`, `clientMethodNames` and `allowIn` adjust the scope. The rule is not in `recommended`, so a project spreading `recommended` sees no new errors.
