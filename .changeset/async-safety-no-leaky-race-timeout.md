---
'@noctcore/eslint-plugin-async-safety': minor
---

New rule `no-leaky-race-timeout`, in `recommended` at `error`. It flags the hand-rolled timeout `Promise.race([work, new Promise((_, reject) => setTimeout(reject, ms))])` when the `setTimeout` handle is discarded, or kept but never passed to `clearTimeout` after the race, so the timer stays pending (and keeps a Node process alive) whenever `work` wins. A `clearTimeout` in a `finally`, in a `.finally(...)` on the race, or after the awaited race counts as a fix, as does switching to `AbortSignal.timeout(ms)`. It leaves alone races without a timer, a `setTimeout` imported from `node:timers/promises`, and handles it cannot follow. A project that spreads `recommended` as-is will see new errors wherever it races an uncleared timer.
