# `noctcore-code-quality/no-template-trim-empty-ternary`

> Extract the inline `` `…`.trim() === '' ? fallback : `…`.trim() `` pattern to a named util. **Niche — not in `recommended`.**

<!-- begin generated rule header -->
Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

The inline shape `` `${a} ${b}`.trim() === '' ? fallback : `${a} ${b}`.trim() `` builds the same
template-plus-`trim()` expression **twice** and buries a small piece of display logic where it can't be
unit-tested on its own. Extracting it to a named helper (e.g. `buildDisplayName(...)`) builds the
expression once and gives it one testable home.

This is a very specific pattern, so the rule is **excluded from the `recommended` preset**. Enable it
explicitly if the shape recurs in your codebase.

### Enabling it

Not part of `recommended`. Turn it on directly:

```js
'noctcore-code-quality/no-template-trim-empty-ternary': 'error'
```

## What it flags

A `ConditionalExpression` whose test is a `===` / `!==` comparison between an **empty-string literal**
and a **`.trim()` call on a template literal**, in either order.

```ts bad reports=2
const name = `${first} ${last}`.trim() === '' ? email : `${first} ${last}`.trim();
const label = '' !== `${a}`.trim() ? `${a}`.trim() : fallback;
```

```ts good
const name = buildDisplayName({ first, last, fallback: email });
const trimmed = value.trim() === '' ? fallback : value; // not a template literal
```

## What it does not flag

- A `.trim()` empty check on anything that is not a template literal (`value.trim() === ''`).
- A trimmed template outside a ternary test (`` const label = `${first} ${last}`.trim(); ``).

## When not to use it

If this pattern doesn't appear in your codebase, there's nothing to gain from enabling it.
