# `noctcore-contracts/no-error-stringify`

> Stringifying an error with `${error}`, `error.toString()`, or `error + ""` drops its cause chain.

## Why

`` `${error}` ``, `error.toString()`, and `error + ""` all coerce an `Error` to its `message` alone,
discarding `error.cause`, the stack, and any custom fields. The value that reaches your logs is a bare
sentence with no chain to the underlying failure. The guarded extractor idiom preserves the object for
structured loggers and stays legal:

```ts
error instanceof Error ? error.message : String(error)
```

## What it flags

Only the three unambiguous cause-chain-dropping forms, and only when the operand is a known error
identifier (default `error`, `err`, `e`, `cause`):

```ts
// ✗
logger.error(`request failed: ${error}`);
const msg = err.toString();
const msg = error + "";
const msg = "" + e;

// ✓  the guarded idiom (bare String(error) is intentionally NOT policed)
const msg = error instanceof Error ? error.message : String(error);
const m = `${error.message}`;
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `errorIdentifierNames` | `string[]` | `['error', 'err', 'e', 'cause']` | Identifier names treated as errors for the three flagged forms. |

```js
'noctcore-contracts/no-error-stringify': ['error', { errorIdentifierNames: ['error', 'cause', 'failure'] }]
```

## When not to use it

If your codebase deliberately renders errors to strings at the boundary (and has already extracted the
cause), or names error bindings unpredictably, this rule may be noisy — narrow or widen
`errorIdentifierNames` to fit.
