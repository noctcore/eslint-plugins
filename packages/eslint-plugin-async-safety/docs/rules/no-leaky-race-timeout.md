# `noctcore-async-safety/no-leaky-race-timeout`

> A `setTimeout` timeout raced with `Promise.race` must be cleared, or the timer outlives the race whenever the other promise wins.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

The hand-rolled timeout races the real work against a promise that rejects after `ms`:

```ts prose reason="illustrates the pattern; the bad example below is the one that runs"
await Promise.race([work, new Promise((_, reject) => setTimeout(reject, ms))]);
```

When `work` settles first, the race is over but the timer is not. Nothing calls `clearTimeout`, so the
timer stays scheduled for the full `ms`, holding its callback and everything that callback closes
over, and in Node it keeps the event loop alive. On a hot path that is one pending timer per call:
memory that climbs under load and a process that will not exit until the last timeout fires
([nodejs/node#37683](https://github.com/nodejs/node/issues/37683)).

TypeScript cannot see this, and the one existing lint rule for leaked timers
(`eslint-react`'s `web-api-no-leaked-timeout`) only looks inside React components.

## What it flags

A global `setTimeout(...)` inside the executor of an inline `new Promise(...)` passed in the array
of a `Promise.race([...])`, when:

- its handle is discarded (an expression statement, the executor's arrow body, or the executor's
  `return`), so it can never be cleared; or
- its handle is kept in a variable that no `clearTimeout(handle)` reaches after the race.

```ts bad reports=2
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  // handle discarded: this timer can never be cleared
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function withTimeoutKept<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // handle kept, but never cleared
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}
```

### How to fix it

Keep the handle and clear it once the race settles, whichever side won. A `finally` block, a
`.finally(...)` chained on the race, or a `clearTimeout` after the awaited race all count:

```ts good
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeoutKept<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
```

Better still, when the work accepts a signal, drop the race and let the platform own the timer:
`AbortSignal.timeout(ms)` cancels the work itself instead of only abandoning it, and has no handle
to leak.

```ts good
async function load(url: string): Promise<Response> {
  return await fetch(url, { signal: AbortSignal.timeout(5000) });
}
```

## What it does not flag

The rule errs toward silence. It does not report:

- a race with no `setTimeout` in an inline `new Promise` executor (`AbortSignal.timeout(ms)`, an
  event, a helper call it cannot see into);
- a `setTimeout` bound locally, such as the promise-returning one imported from
  `node:timers/promises` and passed a `{ signal }`;
- a handle cleared anywhere after the race in the race's own function, inside the race's array, or
  in a callback declared in that function (a `cleanup` helper passed to `.finally` later);
- a handle held by an outer scope (a module-level `let timer`), which any function may clear;
- a handle stored somewhere it cannot follow (`this.timer = ...`, `timers.push(setTimeout(...))`).

## When not to use it

If a long-lived process never races timeouts on a hot path, the leak is bounded and short. The rule
still marks a real pending timer, so prefer the fix over turning it off.
