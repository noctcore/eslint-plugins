# `noctcore-react/require-effect-cancellation`

> A `setState` after an `await`/`.then` inside an effect needs a cancellation guard.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A state update that runs after an async step inside an effect, with nothing to cancel it, is the
classic "setState after unmount / stale response" bug. If the effect re-runs (its deps change) or
the component unmounts before the promise settles, the update lands on a dead effect — and a slow
response can overwrite a newer one. Guard it with an `AbortController`, a `cancelled`/`isMounted`
flag, or a cleanup `return`.

### Severity

Ships as `error` in the `recommended` preset. It is a heuristic and not autofixable, which is an
argument for making it precise rather than for making it advisory: a preset that ships `warn`
gives a consumer a severity they cannot act on, and a project that forbids `warn` outright
cannot use the preset at all. A state update after an await with nothing to cancel it is a real
bug, and any recognisable guard (an AbortController, a cancel flag, a cleanup) silences it.

## What it flags

An `await` (or a `.then(cb)`) inside a `useEffect` / `useLayoutEffect` callback, followed by a
call of a `useState` setter or a `useReducer` dispatch, when the effect has **no** recognisable
cancellation guard. The setter is resolved through scope analysis, so `setTimeout`, `setInterval`
and a setter from a context hook or a prop are not state updates here:

```tsx bad
// nothing cancels the update
const [data, setData] = useState(null);
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
const [data, setData] = useState(null);
useEffect(() => {
  let cancelled = false;
  fetchThing(id).then((data) => {
    if (!cancelled) setData(data);
  });
  return () => { cancelled = true; };
}, [id]);
```

### A cleanup that cancels something else

A cleanup that only clears a timer or removes a listener does nothing for the pending request, so
the effect is still checked.

```tsx bad
// the cleanup stops the poll, not the load
function Feed() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const id = setInterval(poll, 1000);
    load().then((next) => setItems(next));
    return () => clearInterval(id);
  }, []);
  return <List items={items} />;
}
```

```tsx good
// the same cleanup also stops the pending update
function Feed() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(poll, 1000);
    load().then((next) => {
      if (!cancelled) setItems(next);
    });
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return <List items={items} />;
}
```

## What it does not flag

The rule is intentionally conservative: any recognisable guard — an `AbortController`/`AbortSignal`,
a `cancelled`/`isMounted`-style boolean flag that is read, an `if` test on such a flag, or a cleanup
`return` that can stop the update — silences it, so a real finding is almost always genuine. A
returned cleanup counts when it sets something (`cancelled = true`, `live.current = false`) or calls
an abort or cancel method (`request.cancel()`), and when the rule cannot see into it
(`return unsubscribe`). It also leaves alone:

- a synchronous `setState` in an effect, with no async step;
- an `await` or `.then` with no state update after it.

## When not to use it

If your effects never touch component state after an async step, or you manage cancellation through a
pattern this rule cannot see, disable it.
