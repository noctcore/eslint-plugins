# `noctcore-contracts/require-error-cause`

> Re-throwing inside a `catch` without `{ cause }` severs the chain to the original error. 🔧

## Why

When you catch an error and throw a new one, the new error is what reaches your logger. If you do not
forward the caught error as `cause`, the underlying failure — its message, stack, and any nested
cause — is gone. The stack you see points only at the re-throw site. `Error`'s standard `cause`
option (and every `*Error` subclass that forwards it) preserves the chain:

```ts
try {
  await db.query(sql);
} catch (err) {
  throw new QueryError('load failed', { cause: err }); // chain intact
}
```

## What it flags

A `throw new SomeError(...)` inside a `catch` block when **no** argument carries a `cause` property.
Deliberately conservative:

- Only constructors whose simple name ends in `Error` or `Exception` are treated as errors
  (`Error`, `TypeError`, `ValidationError`, `HttpException`). Throwing `new Response(...)` for
  control flow is not policed.
- Fires only when the enclosing catch binds a plain identifier (`catch (err)`). A parameterless
  `catch {}` or a destructured binding (`catch ({ message })`) has no single name to attach, so the
  throw is left alone.
- Any `cause` property (whatever its value), and any spread the rule cannot see through, counts as
  "has a cause" and suppresses the report — a hand-written cause is never second-guessed.

A `throw` nested in a closure declared inside the catch is still flagged: the binding is genuinely in
scope there. Nested `try/catch` uses the nearest binding.

```ts
// ✗  drops the cause  →  autofixes to `new Error('failed', { cause: err })`
try { work(); } catch (err) { throw new Error('failed'); }

// ✗  merges into an existing options object
try { work(); } catch (err) { throw new HttpError('failed', { status: 500 }); }

// ✓
try { work(); } catch (err) { throw new Error('failed', { cause: err }); }
try { work(); } catch (err) { throw err; }
```

## Fix

Autofix attaches `{ cause: <binding> }`:

- one argument (`new Error('msg')`) → appends a new options object;
- an existing options object → merges `cause` in;
- an empty options object (`{}`) → fills it.

A zero-argument `new SomeError()` is **reported but not autofixed** — inserting an options object as
the first argument could clobber a positional message the rule cannot see.

## Options

None.

## When not to use it

If your error classes do not accept an options object with `cause` (pre-ES2022 targets without a
polyfill), or you deliberately model errors without chaining, leave this rule off.
