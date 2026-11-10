---
'@noctcore/eslint-plugin-query': minor
---

New package `@noctcore/eslint-plugin-query` for TanStack Query and tRPC, starting at 0.1.0 with three rules:

- `trpc-invalidate-with-path-key` (in `recommended` at `error`, autofix): invalidating, refetching, cancelling, removing or resetting a tRPC procedure through an input-less `queryKey()` / `queryFilter()` misses its infinite queries; use `pathKey()` / `pathFilter()`.
- `effect-fired-mutation-must-bind-callbacks` (in `recommended` at `error`): a `mutate(vars, { onSuccess })` inside an effect loses its callback when the observer detaches; put the callbacks on `useMutation`.
- `mutation-requires-error-handling` (opt-in): a `useMutation` with no `onError` on the hook, none at the call, no `catch` around `mutateAsync` and no read of its error state. It resolves the hook's options and follows the result before reporting, and stays silent when it cannot tell.
