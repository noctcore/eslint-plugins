# `noctcore-code-quality/no-historical-comments`

> Comments describe the current invariant, not what the code used to do.

## Why

A comment that frames code against its past — "before the fix", "we used to", "no longer" — rots the
moment the code changes again, and it forces the reader to reconstruct a history they don't need. The
history belongs in the commit message or PR description, where it is durable and out of the way.
This is also a common tell that a comment was generated to narrate a change rather than to explain the code.

## What it flags

Line and block comments (JSDoc `/** … */` blocks are exempt) matching narrow past-framing phrases:
`before/after the fix`, `before/after the refactor`, `we/this used to`, `used to be`, `no longer`,
`kept for backwards/legacy/compat`, `was/were a bug/footgun`, and `historical(ly)`.

```ts
// ✗ We used to read process.env directly here.
// ✗ Before the fix this collapsed to {}.

// ✓ Caps concurrent connections to avoid pool exhaustion.
```

## Options

None.

## When not to use it

If you deliberately keep inline change-history in comments.
