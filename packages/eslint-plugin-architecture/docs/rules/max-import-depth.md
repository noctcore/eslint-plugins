# `noctcore-architecture/max-import-depth`

> A relative import may not climb more than `max` parent levels (default 3). Autofixed to a path alias when one is configured.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 🔧 Fixable with `--fix` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A relative import that climbs several directories (`../../../../shared/log`) is brittle and hard to
read: it couples the file to its exact position in the tree, so moving either end breaks the path. A
path alias (`@/shared/log`) is stable and self-locating. This rule caps how far a relative import may
reach before it must become an alias.

## What it flags

Any relative specifier whose leading `..` run exceeds `max` is reported, on every source-carrying
construct: `import`, `import()`, `export … from`, and `export * from`.

```ts bad
// max: 3 (default)
import b from '../../../../shared/log'; // climbs 4 levels
```

```ts good
import a from '../../../shared';        // exactly at the limit
```

### Autofix

When `alias` maps a directory-anchor segment to an alias prefix, a too-deep import that resolves
*through* that anchor is autofixed:

```js
'noctcore-architecture/max-import-depth': ['error', {
  alias: { src: '@' },
}]
```

```ts bad filename=src/a/b/c/d/deep.ts options={"alias":{"src":"@"}}
// autofixes to: import x from '@/shared/log';
import x from '../../../../shared/log';
```

```ts good filename=src/a/b/c/d/deep.ts options={"alias":{"src":"@"}}
import x from '@/shared/log';
```

With no matching alias anchor on the resolved path, the violation is **reported without a fix** —
there is nothing safe to rewrite it to.

## What it does not flag

- A relative import at or under the limit, including `./local`.
- Alias and bare-package specifiers (`@/shared`, `react`): they never climb.
- Deeper climbs once `max` is raised to cover them.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `max` | `integer` | `3` | Maximum number of `..` parent hops a relative import may take. |
| `alias` | `Record<string, string>` | `{}` | Map of directory-anchor segment → alias prefix used to autofix, e.g. `{ src: '@' }`. |

```js
'noctcore-architecture/max-import-depth': ['error', {
  max: 3,
  alias: { src: '@' },
}]
```

## When not to use it

If you do not use path aliases and genuinely prefer deep relative imports, raise `max` or leave the
rule off.
