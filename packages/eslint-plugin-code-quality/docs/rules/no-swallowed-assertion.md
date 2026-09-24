# `noctcore-code-quality/no-swallowed-assertion`

> An assertion inside a `try` whose `catch` swallows the error can never fail the test.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A failed `expect` or `assert` throws. Put it inside a `try` whose `catch` neither rethrows nor
asserts, and the failure is caught and dropped: the test passes whether the assertion holds or not.
The same happens when an `expect(...).rejects` or `.resolves` chain gets a `.catch(() => {})`.

This is how a flaky test gets "stabilised": wrap the assertion that sometimes fails in a
`try/catch`, log the error, move on. The test goes green and stays green, including when the code
under test is broken. Coding agents do this readily when asked to make a failing suite pass.

[`no-conditional-expect`](./no-conditional-expect.md) covers the opposite shape, an `expect` inside
the `catch` that only runs when something throws. This rule covers the assertion in the `try`.

The rule matches on method names, so it covers Jest, Vitest, Bun and `node:assert` alike.

## What it flags

- A `try` with a `catch`, inside an `it` / `test` callback or a `beforeEach` / `afterEach` /
  `beforeAll` / `afterAll` hook (`.each`, `.concurrent` and `test.step` included), whose protected
  block holds an assertion: `expect(...)`, `assert(...)`, `assert.*(...)`, or `expect` / `assert`
  called on an identifier (`t.expect`, `chai.assert`). An assertion in a callback inside the `try`
  counts too: the error `waitFor(() => expect(...))` rethrows lands in the same `catch`.
- `.catch(handler)` chained on an `expect(...).rejects` or `expect(...).resolves` chain.

In both cases only when the handler swallows the error: it contains no `throw`, no assertion, no
`fail()` / `t.fail()`, and uses the caught error for nothing but a `console.*` call.

```ts bad filename=src/cart.test.ts reports=2
it('loads the cart', async () => {
  try {
    const cart = await loadCart();
    expect(cart.items).toHaveLength(3);
  } catch (error) {
    console.warn('flaky, ignoring', error);
  }
});

it('rejects an unknown id', async () => {
  await expect(loadCart('nope')).rejects.toThrow(NotFoundError).catch(() => {});
});
```

```ts good filename=src/cart.test.ts
it('loads the cart', async () => {
  const cart = await loadCart();
  expect(cart.items).toHaveLength(3);
});

it('rejects an unknown id', async () => {
  await expect(loadCart('nope')).rejects.toThrow(NotFoundError);
});
```

It leaves alone a `catch` that rethrows (even conditionally), asserts, calls `fail()`, or does
something with the error (`done(error)`, `lastError = error`); a `try/finally` with no `catch`;
an assertion that sits in the `catch` rather than the `try`; supertest's `request(app).expect(200)`;
and `try` blocks outside test and hook callbacks, where `assert` is production code. A retry loop
that fails the test after the last attempt is also left alone: when the `try` is inside a loop and
a `throw` or an assertion follows the loop, the per-attempt `catch` is allowed to swallow.

```ts good filename=src/cart.test.ts
it('eventually syncs the cart', async () => {
  let ready = false;
  for (let attempt = 0; attempt < 5 && !ready; attempt++) {
    try {
      expect(await syncStatus()).toBe('done');
      ready = true;
    } catch {
      await sleep(100);
    }
  }
  expect(ready).toBe(true);
});

it('closes the connection', async () => {
  try {
    expect(await query('select 1')).toEqual([{ '?column?': 1 }]);
  } catch (error) {
    if (!(error instanceof ConnectionReset)) throw error;
  }
});
```

## Options

None.

## When not to use it

If your suite wraps assertions in a custom handler that fails the test some other way (for example
a `catch` that sets a flag checked by an `afterEach`), the rule cannot see that and will report it.
Prefer rethrowing; otherwise disable the rule on those lines.
