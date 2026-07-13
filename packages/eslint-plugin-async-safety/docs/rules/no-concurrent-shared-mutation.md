# `noctcore-async-safety/no-concurrent-shared-mutation`

> A read-modify-write of an outer-scope binding inside a concurrent `Promise.all(arr.map(async …))` callback can lose updates.

## Why

`Promise.all(arr.map(async …))` starts every callback before any of them resolve, so their `await` points
interleave. A read-modify-write of a shared outer binding — `total = total + await amount()`, `total += …`,
`count++` after an await — can have two iterations read the same value and one clobber the other. The classic
lost update: the final total is wrong, non-deterministically.

## What it flags

Inside an `async` callback passed to `.map`/`.flatMap`/`.forEach` whose result is wrapped in `Promise.all` /
`Promise.allSettled`, and which contains at least one `await`:

- a compound assignment to an outer binding (`x += …`, `x *= …`, …);
- a self-referential assignment (`x = x + …`);
- an update expression on an outer binding (`x++`, `--x`).

```ts
// ✗ lost updates
let total = 0;
await Promise.all(items.map(async (item) => {
  total += await priceOf(item);
}));

// ✓ collect, then reduce
const prices = await Promise.all(items.map((item) => priceOf(item)));
const total = prices.reduce((a, b) => a + b, 0);
```

Deliberately conservative to distinguish real races from safe patterns:

- `arr.push(…)`, `map.set(…)`, and distinct-index writes (`results[i] = …`) are **not** flagged — they are
  order-tolerant, not lost updates;
- a plain overwrite (`x = await f()`, no self-reference) is **not** flagged — that is last-write-wins, not a read-modify-write;
- a binding declared inside the callback is local per iteration, so it is never flagged;
- the callback must be `async` and contain an `await` — a synchronous callback has no interleaving point.

## Options

None.

## When not to use it

If you intentionally accumulate into shared state and have externally serialized the callbacks (e.g. a mutex, or
a concurrency limit of 1), this rule's warning is a false positive — disable it inline for that block.
