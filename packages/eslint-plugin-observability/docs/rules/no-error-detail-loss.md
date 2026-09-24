# `noctcore-observability/no-error-detail-loss`

> When a catch block reports a failure, log the error itself — not just its message.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A caught error carries a **stack trace** and often a **`cause`** — the parts you actually need to
debug a production failure. A catch block that logs only `e.message`, `String(e)`, or `` `${e}` ``
throws that away: the log records _that_ something failed but not _where_ or _why_.

```ts bad
// stack and cause are gone
try { await run(); } catch (e) {
  logger.error(`run failed: ${e.message}`);
}
```

```ts good
// the whole error survives
try { await run(); } catch (e) {
  logger.error('run failed', { err: e });
}
```

## What it flags

A `catch (e)` block where **all** of the following hold:

- the catch binding is a plain identifier (`catch (e)`);
- the block contains a logger call (so a failure is actually being reported);
- the binding **is** referenced (an unused binding is a different concern); and
- **every** reference to the binding is a lossy form — `e.message`, `String(e)`, or bare `` `${e}` ``.

## What it does not flag

If the error is passed whole anywhere (`logger.error('x', e)`, `{ err: e }`), or `.stack` / `.cause` /
any other property is read, or it is re-thrown, its diagnostics survive and the rule stays silent:

```ts good
// .stack is read: not a lossy form
try { await run(); } catch (e) { logger.error(`failed: ${e.stack}`); }

// mixed use: the full capture wins
try { await run(); } catch (e) { logger.error(`${e.message}`, { err: e }); }
```

Distinct from a fully-**unused** catch binding (`catch (e) { cleanup(); }`), which this rule
deliberately does not touch.

A catch block with no logger call at all (`catch (e) { throw e; }`) is not reporting a failure, so it
is not checked.

## When not to use it

If you deliberately log only messages (e.g. to a user-facing channel that must not include stack
traces) **and** capture the full error elsewhere, this rule will be noisy — scope it off for those
files.
