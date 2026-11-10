# `noctcore-query/effect-fired-mutation-must-bind-callbacks`

> A mutation fired from an effect keeps its `onSuccess` and `onError` on `useMutation`, not on the `mutate()` call.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

TanStack Query has two places for mutation callbacks, and they do not behave the same. Options on
`useMutation({ onSuccess })` run off the mutation itself. Options on the call,
`mutate(vars, { onSuccess })`, run only while the observer that issued the call still has
listeners. A click handler's component is alive when the server answers, so the difference
never shows there. An effect is where it shows: React StrictMode's second effect pass, a route
transition or a quick back-and-forward detach the observer before a slow server answers, and the
per-call handler is never called.

Such effects are usually guarded by a ref so they fire once (the request spends a single-use token
or a rate-limit budget), so the second pass sends no replacement request. The screen sits in its
loading state forever, and because `onError` is dropped the same way, no retry button appears
either.

```tsx bad
function AcceptInvite({ token }: { token: string }) {
  const [state, setState] = useState('checking');
  const fired = useRef(false);
  const accept = useMutation({ mutationFn: acceptInvite });

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    accept.mutate(token, { onSuccess: () => setState('accepted'), onError: () => setState('failed') });
  }, [token]);

  return <Status state={state} />;
}
```

```tsx good
function AcceptInvite({ token }: { token: string }) {
  const [state, setState] = useState('checking');
  const fired = useRef(false);
  const accept = useMutation({
    mutationFn: acceptInvite,
    onSuccess: () => setState('accepted'),
    onError: () => setState('failed'),
  });

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    accept.mutate(token);
  }, [token]);

  return <Status state={state} />;
}
```

## What it flags

A `mutate(...)` or `mutateAsync(...)` call (bare or as a member, `this.` included) whose second
argument is an object literal with `onSuccess`, `onError` or `onSettled`, anywhere inside the
function passed as the first argument of `useEffect` or `useLayoutEffect` (also as
`React.useEffect`), helpers declared inside that function included:

```tsx bad
useEffect(() => {
  const run = () => sync.mutate(draft, { onSettled: () => setSaving(false) });
  const id = setTimeout(run, 500);
  return () => clearTimeout(id);
}, [draft]);
```

## What it does not flag

- Per-call callbacks in an event handler, a submit handler or any function outside an effect: there
  they are the right tool.
- A second argument without a callback key, such as `{ retry: false }`.
- A call in the dependency array, or a `mutate` in a helper defined outside the effect and called
  from it: the check is lexical.

```tsx good
function onSubmit(values: FormValues) {
  save.mutate(values, { onSuccess: () => close() });
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `effectHooks` | `string[]` | `['useEffect', 'useLayoutEffect']` | Hooks whose first-argument function counts as an effect. |
| `mutateMethods` | `string[]` | `['mutate', 'mutateAsync']` | Calls that start a mutation. |
| `perCallCallbacks` | `string[]` | `['onSuccess', 'onError', 'onSettled']` | Per-call option keys that only a live observer delivers. |

```js
'noctcore-query/effect-fired-mutation-must-bind-callbacks': ['error', {
  effectHooks: ['useEffect', 'useLayoutEffect', 'useMountEffect'],
}]
```

## When not to use it

If no effect in your codebase starts a mutation, the rule has nothing to do. It is cheap to leave on.

## Related

- [`mutation-requires-error-handling`](/eslint-plugins/rules/query/mutation-requires-error-handling/)
  checks that a mutation handles its error at all.
