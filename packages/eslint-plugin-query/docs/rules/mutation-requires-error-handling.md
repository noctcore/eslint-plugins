# `noctcore-query/mutation-requires-error-handling`

> A mutation handles its error somewhere visible: on the hook, at the call, or by reading its error state.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A mutation that fails with nothing listening fails silently. The button stops spinning, the form
closes or stays as it was, and the user believes the save went through. TanStack Query gives four
places to notice a failure: `onError` on `useMutation`, `onError` on the `mutate()` call, a
`catch` around `mutateAsync()`, or rendering `error` / `isError`. This rule asks for one of them.

```tsx bad
function RenameButton({ id }: { id: string }) {
  const rename = useMutation({ mutationFn: (name: string) => api.rename(id, name) });
  return <button onClick={() => rename.mutate('Acme')}>Rename</button>;
}
```

```tsx good
function RenameButton({ id }: { id: string }) {
  const rename = useMutation({
    mutationFn: (name: string) => api.rename(id, name),
    onError: (error) => toast.error(error.message),
  });
  return <button onClick={() => rename.mutate('Acme')}>Rename</button>;
}
```

## What it flags

A `useMutation(...)` (also `trpc.x.useMutation(...)`) bound to a variable, whose options resolve
to an object with no `onError`, `throwOnError` or `useErrorBoundary` (or with one set to
`undefined` or `false`), when no use of the result handles the error either:

- `mutate(vars)` with no per-call `onError`;
- `mutateAsync(vars)` used as a bare statement, with `void`, or awaited outside a `try` / `catch`;
- no read of `error`, `isError`, `status`, `failureReason` or `failureCount`.

Options resolve through an inline object, tRPC's `trpc.x.mutationOptions({...})` and a local
`const` holding either.

```tsx bad
export function useStartScan() {
  const mutation = useMutation({ mutationFn: startScan, onSettled: refreshStatus });
  return mutation.isPending ? undefined : () => mutation.mutate();
}
```

```tsx good
export function useStartScan() {
  const mutation = useMutation({ mutationFn: startScan, onSettled: refreshStatus, onError: reportScanFailure });
  return mutation.isPending ? undefined : () => mutation.mutate();
}
```

## What it does not flag

The rule stays silent whenever it cannot know, because a guess here is a false positive:

- options it cannot resolve: a parameter, an import, a call to your own factory, a spread;
- a result that leaves the function: returned from a custom hook, passed to another function,
  stored on an object, or a `mutate` handed to a prop (`onClick={mutate}`);
- a `mutateAsync` that is returned or passed on, so the caller can handle it;
- errors handled globally in `new MutationCache({ onError })`: the rule cannot see the
  `QueryClient` from the component, which is why it is not in `recommended`.

```tsx good
export function useRename(id: string) {
  return useMutation({ mutationFn: (name: string) => api.rename(id, name) });
}

function RenameForm() {
  const { mutate, error } = useMutation({ mutationFn: saveName });
  return <form onSubmit={() => mutate('Acme')}>{error ? <Alert error={error} /> : null}</form>;
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `hooks` | `string[]` | `['useMutation']` | Hooks that create a mutation, matched on the last segment of the callee. |
| `handledBy` | `string[]` | `['onError', 'throwOnError', 'useErrorBoundary']` | Hook option keys that count as handling the error. |

```js
'noctcore-query/mutation-requires-error-handling': ['error', { hooks: ['useMutation', 'useAppMutation'] }]
```

## When not to use it

Leave it off if every mutation error is handled once, in a global `MutationCache({ onError })` or
a custom `useMutation` wrapper that always shows a toast. Measured on two real codebases before it
shipped, it reported 1 of 101 mutations in one and 1 of 33 in the other, both without any handling.

## Related

- [`effect-fired-mutation-must-bind-callbacks`](/eslint-plugins/rules/query/effect-fired-mutation-must-bind-callbacks/)
  covers per-call callbacks that are dropped when the mutation is fired from an effect.
