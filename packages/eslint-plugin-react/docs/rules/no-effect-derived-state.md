# `noctcore-react/no-effect-derived-state`

> An effect that only sets state derived from its dependencies is the "you might not need an effect" anti-pattern.

## Why

An effect whose only job is to `setState` a value purely derived from its own dependencies should
not exist — the value should be computed during render (or with `useMemo`). The effect version runs
an extra render pass, flashes stale UI for a frame, and is a common source of update loops. See the
React docs, ["You Might Not Need an Effect"](https://react.dev/learn/you-might-not-need-an-effect).

## What it flags

This rule is deliberately **conservative** — it fires only on the unambiguous shape:

- a `useEffect` / `useLayoutEffect` with a dependency array;
- a non-async callback whose body is nothing but `setX(...)` statements;
- every setter argument is a pure expression (no calls, awaits, `new`, JSX, or assignments) whose
  identifiers all resolve to a dependency;
- at least one argument actually reads a dependency.

```tsx
// ✗ derived state synced through an effect
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// ✓ compute during render
const fullName = firstName + ' ' + lastName;
```

Anything with a branch, a side effect, an await, a cleanup, or an argument that reaches outside the
dependency array bails out unflagged.

## Options

This rule has no options.

## Severity

Reported as a suggestion; it is a heuristic and ships as `warn` in the `recommended` preset.

## When not to use it

If you rely on the extra render pass an effect gives you (rare, and usually a smell), disable it.
