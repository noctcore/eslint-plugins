# `noctcore-async-safety/forward-abort-signal`

> A function that accepts an `AbortSignal` but never forwards it to the work it awaits leaves that work uncancellable.

## Why

Threading an `AbortSignal` through a call graph is only useful if every layer passes it down. A function that
takes a `signal`, maybe checks `signal.aborted`, but then `await`s a `fetch`/call without passing the signal
along has a dead parameter: callers think they can cancel, but the actual I/O ignores them. The cancel never
reaches the socket.

## What it flags

A function (declaration, expression, or arrow) that:

- accepts an AbortSignal-shaped parameter — named `signal`, typed `AbortSignal`, or the destructured `{ signal }` form; **and**
- contains an awaited call or a `fetch(...)` (something that could have received the signal); **and**
- never forwards the signal — every use is a member-access check (`signal.aborted`, `signal.throwIfAborted()`), or it is unused.

"Forwarding" is deliberately generous: passing the signal as an argument, into an options object, assigning it,
or returning it all count — so the rule errs toward silence rather than false positives.

```ts
// ✗ signal accepted, fetch left uncancellable
async function load(url: string, signal: AbortSignal) {
  return await fetch(url);
}

// ✓ signal forwarded
async function load(url: string, signal: AbortSignal) {
  return await fetch(url, { signal });
}
```

A function with no awaited call or `fetch` (e.g. a pure `while (!signal.aborted)` polling loop) is never flagged
— there is nothing to forward to.

## Options

None.

## When not to use it

If you deliberately accept a signal only to poll `.aborted` in a compute loop with no downstream call, this rule
will still fire when that loop `await`s something (a `sleep`, say) that cannot accept a signal. Disable it inline
for those functions.
