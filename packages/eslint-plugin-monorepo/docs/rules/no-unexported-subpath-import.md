# `noctcore-monorepo/no-unexported-subpath-import`

> Importing a `@scope/pkg/<subpath>` that the target workspace package's `exports` map does not expose.

## Why

A package's `exports` map is its contract: it says exactly which subpaths are public. Importing a
subpath that is *not* in the map — `@acme/contracts/internal/secret` — throws
`ERR_PACKAGE_PATH_NOT_EXPORTED` under modern Node resolution. But a TypeScript `paths` alias or a
bundler that resolves against the filesystem can mask that until the code runs in production. This
rule reads the target package's `exports` from disk and flags the unexported import at lint time.

It is the enforcement counterpart to [`no-deep-package-imports`](./no-deep-package-imports.md): that
rule forbids *any* deep subpath (barrel-only); this one *permits* the subpaths a package deliberately
publishes and only flags the ones it does not.

## What it flags

For each configured scope, a specifier `@scope/pkg/<subpath>` is checked against `@scope/pkg`'s
`exports`. It is **conservative** — it reports only when it can prove the subpath is unexported:

- the specifier targets a configured scope,
- the target package is found in the workspace,
- that package declares an `exports` map, and
- the subpath matches no entry (exact key, `*` wildcard, or trailing-slash folder form; an entry
  mapped to `null` is a block).

If the workspace, the package, or its `exports` cannot be resolved, the rule stays silent rather than
guess. The barrel (`@scope/pkg`) and `@scope/pkg/package.json` are always allowed. A package with no
`exports` map is not restricted.

```ts
// @acme/contracts exports: { ".": "...", "./schemas": "...", "./features/*": "..." }

import a from '@acme/contracts';                 // ✓ barrel
import b from '@acme/contracts/schemas';         // ✓ exact export
import c from '@acme/contracts/features/auth';   // ✓ wildcard export
import d from '@acme/contracts/internal/secret'; // ✗ not exported
import e from '@acme/contracts/schemas/extra';   // ✗ ./schemas does not cover ./schemas/extra
```

## Resolution

The rule walks up from the importing file to the nearest workspace root — a `package.json` with a
`workspaces` field, or a `pnpm-workspace.yaml` — then indexes the workspace packages by name and
reads the target's `exports`. Directory listings and parsed `exports` maps are cached per lint run,
so run ESLint against real file paths, not virtual sources.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scopes` | `string[]` | **(required)** | npm scopes whose packages have their `exports` enforced, e.g. `['@acme']`. |

`scopes` is **required** and has **no default** — with an empty `scopes` array the rule matches
nothing.

```js
'noctcore-monorepo/no-unexported-subpath-import': ['error', { scopes: ['@acme'] }]
```

## In `recommended`

Ships **`'off'`** — like `no-deep-package-imports`, it needs your `scopes`, so a shared preset cannot
safely enable it. Turn it on yourself with your own scopes.

## When not to use it

If your packages do not declare `exports` maps (so subpaths are unrestricted by design), or you rely
on a bundler that maps subpaths independently of `package.json`, this rule has nothing to enforce.
