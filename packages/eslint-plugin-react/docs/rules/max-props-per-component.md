# `noctcore-react/max-props-per-component`

> A props contract wider than the cap means the component does too much.

## Why

A `*Props` contract with many members is a strong signal that the component is doing too much — it is
juggling too many independent concerns. Capping the local surface pushes you to split the component
or group related props into cohesive objects. Members inherited via `extends` (or an intersection)
are **not** counted, so composing a shared base contract stays free while widening the local surface
does not.

## What it flags

Any `*Props` interface or object type-literal alias that declares more than `max` (default **12**)
**locally-declared** members (`TSPropertySignature` / `TSMethodSignature`). The rule is
layout-independent: it keys off the `*Props` naming convention and applies wherever the contract is
declared.

```ts
// ✗ 13 local props
export interface BoardProps {
  a: string; b: string; /* ...11 more... */
}

// ✓ inherited members are free — only the local surface counts
export interface BoardProps extends BaseProps {
  a: string; b: string;
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max` | `integer` (≥1) | `12` | Maximum locally-declared members in a `*Props` contract. |

```js
'noctcore-react/max-props-per-component': ['error', { max: 12 }]
```

## When not to use it

If your codebase does not name props types with a `*Props` suffix, this rule never fires — it keys
off that convention.
