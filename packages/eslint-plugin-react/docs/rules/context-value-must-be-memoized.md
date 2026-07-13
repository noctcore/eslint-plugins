# `noctcore-react/context-value-must-be-memoized`

> A context Provider `value` must be a stable reference, never an inline object literal.

## Why

A context Provider whose `value` is an inline object literal (`<XContext.Provider value={{...}}>`)
allocates a fresh reference every render, so **every** consumer re-renders on every parent render —
a hot subtree can re-render dozens of times a second for no reason. The value must be a stable
reference, produced by `useMemo` (or held in a `useRef`), and passed in.

## What it flags

In a `.tsx` file, a `value={{ ... }}` attribute (an inline object literal) on:

- `<Foo.Provider ...>` / `<FooContext.Provider ...>` — a JSX member element whose property is
  `Provider`;
- `<FooContext ...>` — a bare element whose name ends `Context` (the React 19 context-as-provider
  form).

Custom wrapper components (`<FooProvider value={...}>`) are intentionally **not** matched: the value
they forward is memoized at their single call site, and matching every `*Provider`-named element
would flag unrelated library providers.

```tsx
// ✗ fresh object every render
<TaskStreamContext.Provider value={{ a: 1, b: 2 }}>{children}</TaskStreamContext.Provider>

// ✓ stable, memoized reference
const value = useMemo(() => ({ a, b }), [a, b]);
<TaskStreamContext.Provider value={value}>{children}</TaskStreamContext.Provider>
```

## Options

This rule has no options.

## When not to use it

If a given Provider has no consumers that re-render on identity (rare), the churn is harmless — but
the rule stays cheap to satisfy, so it is usually worth keeping on.
