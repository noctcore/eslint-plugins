# `noctcore-architecture/barrel-purity`

> A barrel (an `index.*` file with an `export … from` re-export) must contain only re-exports, never local declarations, side effects, or default-exported values.

<!-- begin generated rule header -->
☑️ In `strict` at `error`, not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A barrel exists to present a folder's public surface. The moment it also *declares* something — a
const, a function, a type, a default-exported value — or *does* something — a side-effect import, a
top-level call — the barrel becomes a real module with behavior. Every consumer that imports the
folder now silently pulls that behavior in, and the folder no longer has a clean, movable boundary.

## What it flags

Only `index.ts` / `index.tsx` (and the other index extensions) are inspected, and only once the file
re-exports from another module with `export … from` or `export * from`. Each top-level statement in
such a barrel that is not a pure re-export is reported.

```ts good filename=src/components/Card/index.ts
export { Card } from './Card';          // named re-export
export * from './Card.types';           // star re-export
export * as card from './Card';         // namespace re-export
export { default as CardView } from './Card'; // default re-export
import { a } from './a';                // import that feeds a re-export
export { a };                           //   ...its matching specifier
export type { Props } from './Card';    // type re-export
import Card from './Card';
export default Card;                    // re-export of a binding by name
```

```ts bad reports=7 filename=src/components/Card/index.ts
export { Card } from './Card';          // makes the file a barrel; not reported
export const helper = 1;                // local declaration
export function build() {}              // local declaration
export type T = string;                 // local declaration
export default () => 1;                 // a value, not a re-export
import './styles.css';                  // side-effect import
console.log('hi');                      // side-effect statement
const cache = new Map();                // non-export code
```

An import that carries bindings is allowed because it feeds a re-export; a specifier-less
`import './x'` is a side effect and is flagged.

## What it does not flag

- Any file that is not an `index` barrel: a `helper.ts` full of logic is none of this rule's business.
- An `index.*` file with no `export … from`, such as a server or package entry point. Its name says
  nothing about it being a barrel, so it is left alone. That includes a file that only exports
  bindings it imported (`import { rules } from './rules'; export { rules }`), which is how a plugin
  entry point hands out its parts:

```ts good filename=src/index.ts relocation
import { createServer } from './server';

const app = createServer();
app.listen(3000);
```

- Pure re-exports in every form shown in the `good` example, including an import whose bindings feed a
  specifier-only `export { a }` and `export default Card` of a binding by name.
- Barrels whose path matches an `allowIn` glob.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` | `[]` | Globs (supporting `**`, `*`, `?`) of barrel paths to exempt entirely. |
| `allow` | `string[]` | (none) | Deprecated alias of `allowIn`, kept through 1.x. When both are set, their globs are combined. |

```js
'noctcore-architecture/barrel-purity': ['error', {
  allowIn: ['**/legacy/**'],
}]
```

## When not to use it

If you deliberately keep small helpers or feature flags inside a package's `index.ts`, this rule will
fight you. Prefer moving them into a sibling module and re-exporting — but if you cannot, disable the
rule for those paths via `allowIn`.
