# `noctcore-react/max-hook-return-surface`

> Cap the return surface of an exported hook so it does not become a god-controller.

## Why

Counting how many hooks a file exports misses the shape where a **single** hook returns a 55-member
controller object. It passes every count rule while being the definitive "doing too much" surface.
Bounding the number of members a hook exposes forces it to split into focused hooks or return
cohesive sub-objects.

## What it flags

In a hook file (basename ending with a `hookFileSuffixes` entry, default `.hooks.ts`), an **exported**
`use*` hook whose returned object literal exposes more than `max` (default **20**) members. Both the
top-level return and objects nested **one** level deep (the `board: {...}` controller pattern) are
measured. Each spread element counts as 1 (though it hides arbitrary extra surface). Non-exported
hooks and non-hook functions are ignored, as is nesting deeper than one level.

```ts
// ✗ a 21-member controller (useBoard in Board.hooks.ts)
export function useBoard() {
  return { a, b, c, /* ...18 more... */ };
}

// ✓ split into cohesive sub-objects (each under the cap)
export function useBoard() {
  return { columns, selection, actions };
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max` | `integer` (≥1) | `20` | Maximum members a returned object literal may expose. |
| `hookFileSuffixes` | `string[]` | `['.hooks.ts']` | Basename suffixes identifying the hook files to scan. |

```js
'noctcore-react/max-hook-return-surface': ['error', { max: 20 }]
```

## When not to use it

If your hooks legitimately return wide value objects (e.g. a generated API client surface), raise
`max` or disable the rule for those files.
