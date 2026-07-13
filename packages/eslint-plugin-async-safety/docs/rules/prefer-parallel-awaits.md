# `noctcore-async-safety/prefer-parallel-awaits`

> Consecutive independent awaits run sequentially — they could run concurrently with `Promise.all`. 💡

## Why

`const a = await getUser(); const b = await getFeed();` waits for `getUser` to finish before `getFeed` even
starts. When the two have no data dependency, that is latency added for nothing: `await Promise.all([...])`
runs them concurrently and finishes in the time of the slower one.

## What it flags

A run of two or more **consecutive** statements of the exact shape `const <id> = await <call>()`, where:

- every awaited expression is a single flat call whose arguments hide no nested call, `await`, or assignment
  (so side-effect ordering stays out of scope);
- the callee does not look like a mutation (`save*`, `create*`, `send*`, `commit*`, `push*`, …) — sequencing
  writes is usually intentional;
- no later statement references an earlier statement's binding (no data dependency).

```ts
// ✗ sequential, but independent
const user = await getUser();
const feed = await getFeed();

// ✓ concurrent
const [user, feed] = await Promise.all([getUser(), getFeed()]);
```

The rule is intentionally conservative — a data dependency, a mutation-looking callee, a `let`, a nested call
argument, or any non-await statement between them all suppress it.

## Suggestion

Reports offer an editor suggestion (never an autofix, since parallelizing also changes rejection timing) that
rewrites the run into a single `const [a, b] = await Promise.all([...])`.

## Options

None.

## When not to use it

If your consecutive awaits carry side effects whose ordering matters but that this rule cannot see (e.g. reads
that mutate a stream), disable it — the suggestion assumes the awaited reads are independent.
