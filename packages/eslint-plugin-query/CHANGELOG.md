# @noctcore/eslint-plugin-query

## 0.2.0

### Minor Changes

- [#209](https://github.com/noctcore/eslint-plugins/pull/209) [`3337983`](https://github.com/noctcore/eslint-plugins/commit/333798315068ceb7e55df08e5655d93c991c0fc6) Thanks [@Shironex](https://github.com/Shironex)! - Add the opt-in rule `query-key-must-be-constant`. It flags an inline key array that starts with a string or template literal, in the `queryKey` or `mutationKey` of `useQuery`, `useInfiniteQuery`, `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `queryOptions` and each element of `useQueries({ queries })`, and in `invalidateQueries`, `setQueryData`, `removeQueries`, `getQueryData` and `prefetchQuery`, both as a filter object and as a positional first argument. Constants, key factory calls, arrays that start with a spread and test files are left alone; `keyHookNames`, `clientMethodNames` and `allowIn` adjust the scope. The rule is not in `recommended`, so a project spreading `recommended` sees no new errors.

## 0.1.0

### Minor Changes

- [#167](https://github.com/noctcore/eslint-plugins/pull/167) [`8aed9ba`](https://github.com/noctcore/eslint-plugins/commit/8aed9ba1f6179e5711abd6f44a470be5985436df) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-query` for TanStack Query and tRPC, starting at 0.1.0 with three rules:
  
  - `trpc-invalidate-with-path-key` (in `recommended` at `error`, autofix): invalidating, refetching, cancelling, removing or resetting a tRPC procedure through an input-less `queryKey()` / `queryFilter()` misses its infinite queries; use `pathKey()` / `pathFilter()`.
  - `effect-fired-mutation-must-bind-callbacks` (in `recommended` at `error`): a `mutate(vars, { onSuccess })` inside an effect loses its callback when the observer detaches; put the callbacks on `useMutation`.
  - `mutation-requires-error-handling` (opt-in): a `useMutation` with no `onError` on the hook, none at the call, no `catch` around `mutateAsync` and no read of its error state. It resolves the hook's options and follows the result before reporting, and stays silent when it cannot tell.

### Patch Changes

- Updated dependencies [[`5370208`](https://github.com/noctcore/eslint-plugins/commit/5370208686ef812a0387e89ebb5a794adb6d7dd3), [`4e1129f`](https://github.com/noctcore/eslint-plugins/commit/4e1129f70f9449f4feee9dca6228f2d6432393c5), [`6ef2434`](https://github.com/noctcore/eslint-plugins/commit/6ef2434bae1749d4d0ef5c8368cd8e762ba2a91c), [`bd8ee6a`](https://github.com/noctcore/eslint-plugins/commit/bd8ee6afedd488ed8f582c0d3d9293db44cca7a7), [`663c5dd`](https://github.com/noctcore/eslint-plugins/commit/663c5ddb58c9b93449d2e673715f2f7133563a70), [`a935769`](https://github.com/noctcore/eslint-plugins/commit/a935769c3895387adcdd7bdaddd8354c7f3559b5), [`e6bfa65`](https://github.com/noctcore/eslint-plugins/commit/e6bfa651c1e9ed13907f2388ce9cd2ea9622a80d)]:
  - @noctcore/eslint-utils@0.2.0
