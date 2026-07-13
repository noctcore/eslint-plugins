# `noctcore-contracts/restrict-throw-to-taxonomy`

> `throw` only members of your error taxonomy — never an ad hoc built-in nor a bare value.

## Why

A codebase that throws a curated set of error types can handle them exhaustively at the boundary:
one place maps `AppError` → HTTP status, `ValidationError` → 422, and so on. Throwing an arbitrary
built-in (`TypeError`, `RangeError`) or, worse, a bare value (`throw 'nope'`, `throw { code }`)
breaks that: a non-Error carries no stack and no cause, and an unclassified error falls through every
`instanceof` branch.

## What it flags

- `throw new SomethingError(...)` whose constructor is **not** in the `allow` list.
- `throw <non-Error value>` — a string, number, boolean, template literal, object, or array literal.

Conservative on the ambiguous forms. A bare identifier (`throw err` — the re-throw), a member
(`throw ctx.error`), and a call (`throw makeError()`) are all left alone: a syntactic rule cannot know
whether they resolve to an Error, and re-throwing a caught error is the most common `throw` there is.

```ts
// ✗  built-in not in the taxonomy
throw new TypeError('bad');

// ✗  bare values
throw 'boom';
throw { code: 500 };

// ✓  (default allow is ['Error'])
throw new Error('boom');
try { work(); } catch (err) { throw err; }
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allow` | `string[]` | `['Error']` | Constructor names permitted as throw targets. Extend it with your base errors **and** any built-ins you legitimately raise. |

```js
'noctcore-contracts/restrict-throw-to-taxonomy': ['error', {
  allow: ['AppError', 'ValidationError', 'NotFoundError', 'TypeError'],
}]
```

The default `['Error']` is intentionally strict — it assumes a taxonomy rooted at `Error` and treats
every other built-in as something you should opt into. Widen `allow` to match your project's error
model on day one.

## When not to use it

If you have no error taxonomy yet, or intentionally throw built-ins throughout, leave this rule off
until you have a base error class worth enforcing.
