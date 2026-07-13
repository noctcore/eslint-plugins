# `noctcore-architecture/barrel-purity`

> A barrel (`index.ts` / `index.tsx`) must contain only re-exports — never local declarations, side effects, or default-exported values.

## Why

A barrel exists to present a folder's public surface. The moment it also *declares* something — a
const, a function, a type, a default-exported value — or *does* something — a side-effect import, a
top-level call — the barrel becomes a real module with behavior. Every consumer that imports the
folder now silently pulls that behavior in, and the folder no longer has a clean, movable boundary.

## What it flags

Only `index.ts` / `index.tsx` (and the other index extensions) are inspected. Each top-level
statement that is not a pure re-export is reported.

```ts
// index.ts

export { Card } from './Card';          // ✓ named re-export
export * from './Card.types';           // ✓ star re-export
export * as card from './Card';         // ✓ namespace re-export
export { default as Card } from './Card'; // ✓ default re-export
import { a } from './a';                // ✓ import that feeds a re-export
export { a };                           //   …its matching specifier
export type { Props } from './Card';    // ✓ type re-export
export default Card;                    // ✓ re-export of a binding by name

export const helper = 1;                // ✗ local declaration
export function build() {}              // ✗ local declaration
export type T = string;                 // ✗ local declaration
export default () => 1;                 // ✗ a value, not a re-export
import './styles.css';                  // ✗ side-effect import
console.log('hi');                      // ✗ side-effect statement
const cache = new Map();                // ✗ non-export code
```

An import that carries bindings is allowed because it feeds a re-export; a specifier-less
`import './x'` is a side effect and is flagged.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allow` | `string[]` | `[]` | Globs (supporting `**`, `*`, `?`) of barrel paths to exempt entirely. |

```js
'noctcore-architecture/barrel-purity': ['error', {
  allow: ['**/legacy/**'],
}]
```

## When not to use it

If you deliberately keep small helpers or feature flags inside a package's `index.ts`, this rule will
fight you. Prefer moving them into a sibling module and re-exporting — but if you cannot, disable the
rule for those paths via `allow`.
