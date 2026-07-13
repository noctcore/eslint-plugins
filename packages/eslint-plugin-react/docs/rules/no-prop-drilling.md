# `noctcore-react/no-prop-drilling`

> A bundle of props forwarded unchanged to the same child is prop drilling — compose instead.

## Why

Passing a single prop straight through (`onClose`, `className`) is fine — that's leaf forwarding.
But when a component destructures four-or-more props from its `*Props` contract and forwards **every
one of them unchanged** (`name={name}`) to the **same** child, that component isn't an owner of
anything; it's a wire. The state wants to live closer to where it's used. Fixes: pass a grouped
object, render the child as `children`, or read the values from a scoped context.

## What it flags

Inside any function component whose first parameter is an object pattern annotated with a `*Props`
type, the rule groups props by the child they're forwarded to and reports when a single child
receives `maxForwarded` (default **4**) or more **unchanged** pass-throughs.

A prop is only counted when **every** read of it is a `name={name}` pass-through to an
uppercase (component-typed) JSX element. Any local use, rename (`x={y}`), spread, `key` forward, or
forward to a lowercase DOM element disqualifies it.

```tsx
// ✗ four unchanged forwards to one child
function Board({ a, b, c, d }: BoardProps) {
  return <Column a={a} b={b} c={c} d={d} />;
}

// ✓ split across children, renamed, or locally used
function Board({ a, b, c, d }: BoardProps) {
  return (
    <>
      <Column a={a} b={b} />
      <Sidebar c={c} d={d} />
    </>
  );
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxForwarded` | `integer` (≥2) | `4` | Number of unchanged forwards to one child that trips the rule. |

```js
'noctcore-react/no-prop-drilling': ['error', { maxForwarded: 3 }]
```

## When not to use it

If your codebase does not name prop types with a `*Props` suffix, this rule never fires — it keys
off that convention to stay quiet on non-component functions.
