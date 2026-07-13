# `noctcore-react/max-hooks-per-file`

> A hook/query/mutation file may export only a handful of `use*` hooks before it should be split.

## Why

A feature data file that accumulates many exported hooks becomes a grab-bag: unrelated queries and
mutations pile up behind one import, and the file's responsibility blurs. Capping the number of
exported `use*` hooks keeps each file focused and nudges you to split by concern before it sprawls.

## What it flags

In a file whose basename ends with a `fileSuffixes` entry (default `.hooks.ts`, `.queries.ts`,
`.mutations.ts`), when the number of **exported** `use*` hooks exceeds `max` (default **4**). Only
exported hook factories count — internal helper hooks are free. Hooks exported via a specifier list
(`export { useA, useB }`) and under aliases (`export { useA as helperA }`) still count by their local
factory name, so aliasing cannot bypass the limit.

```ts
// ✗ five exported hooks in Board.queries.ts
export function useA() {}
export function useB() {}
export function useC() {}
export function useD() {}
export function useE() {}

// ✓ split into focused query/mutation files
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max` | `integer` (≥1) | `4` | Maximum exported `use*` hooks per file. |
| `fileSuffixes` | `string[]` | `['.hooks.ts', '.queries.ts', '.mutations.ts']` | Basename suffixes identifying the files this rule constrains. |

```js
'noctcore-react/max-hooks-per-file': ['error', { max: 4 }]
```

## When not to use it

If you do not use a dotted-role file grammar (`*.hooks.ts` etc.), point `fileSuffixes` at your own
convention — or disable the rule if you do not bucket hooks by file at all.
