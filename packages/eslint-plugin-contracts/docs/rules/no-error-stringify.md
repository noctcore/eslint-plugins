# `noctcore-contracts/no-error-stringify`

> Stringifying an error with `${error}`, `error.toString()`, or `error + ""` gives "Error: <message>" or "[object Object]".

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💡 Offers editor suggestions · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`` `${error}` ``, `error.toString()`, and `error + ""` coerce an `Error` to `"Error: <message>"` (the
class name glued to the message) and a thrown plain object to `"[object Object]"`, discarding
`error.cause`, the stack, and any custom fields. The guarded extractor idiom gives a readable message
and stays legal; to keep the stack and cause, pass the error object itself to a structured logger:

```ts good
error instanceof Error ? error.message : String(error)
```

## What it flags

Only the three unambiguous forms, and only when the operand holds an error: any name bound by a
`catch (x)` clause or by a rejection handler (`.catch((x) => ...)`, the second callback of `.then`),
plus any identifier named in `errorIdentifierNames` (default `error`, `err`):

```ts bad reports=5
logger.error(`request failed: ${error}`);
const a = err.toString();
const b = error + "";
try { run(); } catch (e) { log("" + e); }
load().catch((cause) => log(`failed: ${cause}`));
```

Each report offers a suggestion that rewrites the expression to the guarded idiom.

```ts good
// the guarded idiom (bare String(error) is intentionally NOT policed)
const msg = error instanceof Error ? error.message : String(error);
const m = `${error.message}`;
```

## What it does not flag

- Bare `String(error)`, which the guarded extractor idiom relies on.
- Member reads such as `` `${error.message}` `` or `error.stack`.
- `x + ""` where `x` is not one of `errorIdentifierNames` (`count + ""`).
- Short names that a catch did not bind: `sizes.map((e) => \`${e}px\`)`, `` `because ${cause}` `` with a
  string parameter.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `errorIdentifierNames` | `string[]` | `['error', 'err']` | Identifier names treated as errors wherever they appear. Catch-bound names count without being listed. |

```js
'noctcore-contracts/no-error-stringify': ['error', { errorIdentifierNames: ['error', 'cause', 'failure'] }]
```

## When not to use it

If your codebase deliberately renders errors to strings at the boundary (and has already extracted the
cause), or names error bindings unpredictably, this rule may be noisy — narrow or widen
`errorIdentifierNames` to fit.
