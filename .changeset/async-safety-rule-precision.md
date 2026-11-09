---
'@noctcore/eslint-plugin-async-safety': minor
---

Fix false positives and false negatives in five rules.

**A project that spreads `recommended` sees new errors from two rules it already runs**, which is why this is a minor bump:

- `require-fetch-timeout` now reports `fetch(url)` when `url` is a variable. The first argument of `fetch` is the resource, never the options, so the old "it may be an options bag" exemption hid almost every real call. A `Request` built in view (`fetch(new Request(url, { signal }))`, or a `const` initialised that way) is still exempt. `timeout` no longer counts as a bound for the global `fetch`, because `fetch` has no such option: `fetch('/api', { timeout: 5 })` is reported. It still counts for wrappers named in `callees`, and a wrapper's lone non-string argument (`axios(config)`) is still skipped.
- `no-leaky-race-timeout` now follows a timeout promise held in a `const`: `const timeout = new Promise((_, r) => setTimeout(r, ms)); Promise.race([work, timeout])` is reported like the inline form.

**Reports less:**

- `no-concurrent-shared-mutation` reports only when an `await` sits between the read and the write: `total += await size(i)` and `total = await add(total, i)`. `await save(i); done++;` and `const n = await size(i); total += n;` read and write in one synchronous step, cannot lose an update, and are no longer reported. `x++` is never reported.
- `forward-abort-signal` no longer takes a parameter named `signal` as an `AbortSignal` when its type annotation says otherwise (`process.on('SIGTERM', async (signal: NodeJS.Signals) => ...)`). An untyped `signal` and any annotation that mentions `AbortSignal` are checked as before. Hooking the abort event by hand (`signal.addEventListener('abort', ...)`, `signal.onabort = ...`) now counts as forwarding.

**Suggestion change:** `prefer-parallel-awaits` (opt-in) still reports a run that carries a type annotation or a comment, but no longer offers the one-line rewrite that would drop them.
