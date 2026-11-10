# `noctcore-async-safety/require-fetch-timeout`

> A `fetch` (or configured wrapper) call must carry a cancellation signal or timeout — an unbounded request can hang forever. 💡

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💡 Offers editor suggestions · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`fetch` has no default timeout. A hung TCP connection or a server that accepts but never responds leaves the
promise pending indefinitely, tying up a request slot, a connection, and any resources awaiting it. Passing
`signal: AbortSignal.timeout(ms)` (or an equivalent `timeout` option on a wrapper) bounds the wait and makes
the failure observable.

## What it flags

A call to global `fetch` whose options carry no `signal`, or a call to a wrapper named in the `fetchCallees` option
(e.g. `undici.request`, `got`) whose options carry neither a `signal` nor a `timeout`. `timeout` is not a
`fetch` option, so it only counts for wrappers.

It reports only when the arguments are plainly signal-free: a visible options object literal without the key,
or no options at all. The first argument of `fetch` is always the resource, so `fetch(url)` is reported whatever
`url` is. A wrapper's lone argument may be its config bag (`axios(config)`), so for wrappers only a
string/template URL with no options is reported.

```ts bad reports=3
// no timeout: can hang forever
await fetch('https://api.example.com/data');
await fetch(url);
await fetch(url, { method: 'POST' });
```

```ts good
// bounded
await fetch('https://api.example.com/data', { signal: AbortSignal.timeout(10000) });
await fetch(url, { method: 'POST', signal: controller.signal });
```

### Suggestion

Reports offer an editor suggestion (not an autofix) that inserts `signal: AbortSignal.timeout(<defaultTimeoutMs>)`
into the options object, creating one if needed.

## What it does not flag

The rule is purely syntactic and stays silent whenever it cannot see the arguments:

- a spread argument (`fetch(url, ...opts)`) or a `...spread` inside the options object — opaque, skipped;
- an options slot that is an identifier/call/member (`fetch(url, opts)`) — that bag may already set a signal, skipped;
- a `Request` built in view (`fetch(new Request(url, { signal }))`, or a `const` initialised with
  `new Request(...)`): it can carry its own signal, skipped;
- a wrapper named in `fetchCallees` called with one non-string argument (`axios(config)`): that may be the config bag, skipped.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetchCallees` | `(string \| object)[]` | `[]` | Wrappers to check besides the global `fetch` (`'axios'`, `'undici.request'`). `fetch` is always checked. |
| `callees` | `string[]` | (none) | Deprecated alias of `fetchCallees`, kept through 1.x. When both are set, the lists are combined. |
| `defaultTimeoutMs` | `integer` (≥1) | `10000` | The timeout value used in the suggestion. |

```js
'noctcore-async-safety/require-fetch-timeout': ['error', { fetchCallees: ['undici.request'], defaultTimeoutMs: 5000 }]
```

The same `fetchCallees` list works for async-safety `require-fetch-timeout`, contracts `fetch-must-check-ok` and security `no-user-controlled-fetch-url`, so declare a wrapper once and pass it to all three. An entry is a string (`'http.fetchWithRetry'`: the last segment is the method, the rest the receiver as written) or an object (`{ object: 'axios', name: 'get', urlArgument: 0, urlProperty: 'url' }`).

## When not to use it

If your `fetch` wrapper enforces a timeout centrally (an interceptor, a default `AbortSignal`), the per-call
signal is redundant — leave `fetchCallees` at its default so only bare `fetch` is checked, or disable the rule.
