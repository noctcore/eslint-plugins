# `noctcore-async-safety/require-fetch-timeout`

> A `fetch` (or configured wrapper) call must carry a cancellation signal or timeout — an unbounded request can hang forever. 💡

## Why

`fetch` has no default timeout. A hung TCP connection or a server that accepts but never responds leaves the
promise pending indefinitely, tying up a request slot, a connection, and any resources awaiting it. Passing
`signal: AbortSignal.timeout(ms)` (or an equivalent `timeout` option on a wrapper) bounds the wait and makes
the failure observable.

## What it flags

A call to global `fetch` — or any wrapper named in the `callees` option (e.g. `undici.request`, `axios`) —
whose options carry neither a `signal` nor a `timeout`.

The rule is purely syntactic and stays silent whenever it cannot see the arguments:

- a spread argument (`fetch(url, ...opts)`) or a `...spread` inside the options object — opaque, skipped;
- an options slot that is an identifier/call/member (`fetch(url, opts)`) — that bag may already set a signal, skipped;
- a single non-string argument (`fetch(request)`) — could be a `Request` carrying its own signal, skipped.

It reports only when the arguments are plainly signal-free: a bare string/template URL, or a visible options
object literal with neither key.

```ts
// ✗ no timeout — can hang forever
await fetch('https://api.example.com/data');
await fetch(url, { method: 'POST' });

// ✓ bounded
await fetch('https://api.example.com/data', { signal: AbortSignal.timeout(10000) });
await fetch(url, { method: 'POST', signal: controller.signal });
```

## Suggestion

Reports offer an editor suggestion (not an autofix) that inserts `signal: AbortSignal.timeout(<defaultTimeoutMs>)`
into the options object, creating one if needed.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `callees` | `string[]` | `[]` | Additional callee texts to check, matched literally (`'axios'`, `'undici.request'`). `fetch` is always checked. |
| `defaultTimeoutMs` | `integer` (≥1) | `10000` | The timeout value used in the suggestion. |

```js
'noctcore-async-safety/require-fetch-timeout': ['error', { callees: ['undici.request'], defaultTimeoutMs: 5000 }]
```

## When not to use it

If your `fetch` wrapper enforces a timeout centrally (an interceptor, a default `AbortSignal`), the per-call
signal is redundant — leave `callees` at its default so only bare `fetch` is checked, or disable the rule.
