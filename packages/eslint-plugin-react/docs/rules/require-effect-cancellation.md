# `noctcore-react/require-effect-cancellation`

> A `setState` after an `await`/`.then` inside an effect needs a cancellation guard.

## Why

A state update that runs after an async step inside an effect, with nothing to cancel it, is the
classic "setState after unmount / stale response" bug. If the effect re-runs (its deps change) or
the component unmounts before the promise settles, the update lands on a dead effect — and a slow
response can overwrite a newer one. Guard it with an `AbortController`, a `cancelled`/`isMounted`
flag, or a cleanup `return`.

## What it flags

An `await` (or a `.then(cb)`) inside a `useEffect` / `useLayoutEffect` callback, followed by a
`setState`/`dispatch`, when the effect has **no** recognisable cancellation guard:

```tsx bad
// nothing cancels the update
useEffect(() => {
  async function load() {
    const data = await fetchThing(id);
    setData(data);
  }
  load();
}, [id]);
```

```tsx good
// guarded with a cancelled flag
useEffect(() => {
  let cancelled = false;
  fetchThing(id).then((data) => {
    if (!cancelled) setData(data);
  });
  return () => { cancelled = true; };
}, [id]);
```

The rule is intentionally conservative: any recognisable guard — an `AbortController`/`AbortSignal`,
a `cancelled`/`isMounted`-style boolean flag that is read, an `if` test on such a flag, or a cleanup
`return` — silences it, so a real finding is almost always genuine.

## Options

This rule has no options.

## Severity

Ships as `error` in the `recommended` preset. It is a heuristic and not autofixable, which is an
argument for making it precise rather than for making it advisory: a preset that ships `warn`
gives a consumer a severity they cannot act on, and a project that forbids `warn` outright
cannot use the preset at all. A state update after an await with nothing to cancel it is a real
bug, and any recognisable guard (an AbortController, a cancel flag, a cleanup) silences it.

## When not to use it

If your effects never touch component state after an async step, or you manage cancellation through a
pattern this rule cannot see, disable it.
