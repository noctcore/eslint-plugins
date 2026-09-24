# `noctcore-monorepo/no-deep-package-imports`

> Workspace packages must be consumed through their package barrel only — never via a deep subpath into package internals.

<!-- begin generated rule header -->
⚙️ Opt-in: `off` in `recommended`; needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A monorepo's layering only holds if each package presents a single public surface. A deep import
like `@acme/contracts/internal/thing` reaches past the barrel and couples consumers to internals,
letting the dependency graph drift from the declared edges.

This is a custom AST rule rather than a `no-restricted-imports` pattern on purpose: flat-config
`no-restricted-imports` does not merge across blocks (the last matching block wins), so stacking
another restricted-imports block risks silently overriding an existing one. A distinct-named rule
composes cleanly.

### In `recommended`

The `recommended` preset ships this rule as **`'off'`**. Because there is no universal default scope,
enabling it in a shared preset would either do nothing (empty scopes) or fire against the wrong
packages in a stranger's repo. Turn it on yourself with your own `scopes`:

```js
import monorepo from '@noctcore/eslint-plugin-monorepo';

export default [
  monorepo.configs.recommended, // rule present but off
  {
    rules: {
      'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }],
    },
  },
];
```

## What it flags

For each configured scope, an import/export/`import()` whose specifier is `@scope/<pkg>/<subpath>`
(anything past the package barrel) is reported. The rule inspects the specifier string only — it
never reads the file path, so it is layout-independent.

```ts bad reports=2 options={"scopes":["@acme"]}
// deep subpath into a package's internals
import { thing } from '@acme/contracts/internal/thing';
export { x } from '@acme/engine/src/sdk-adapter';
```

```ts good options={"scopes":["@acme"]}
// the barrel is the public surface
import { TaskSchema } from '@acme/contracts';
```

If a deep entry is genuinely intended, add an explicit `exports` subpath to the target package and
import that public subpath — or list the subpath under `allowedSubpaths`.

## What it does not flag

- The barrel itself (`@scope/<pkg>`), including re-exports from it and a bare trailing slash
  (`@acme/contracts/`).
- Specifiers in scopes you did **not** configure (`zod/lib`, `@other/pkg/internal/thing`).
- Subpaths listed in `allowedSubpaths`, and everything when `scopes` is empty.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scopes` | `string[]` | **(required)** | npm scopes whose packages must be reached through their barrel, e.g. `['@acme']`. |
| `allowedSubpaths` | `string[]` | `[]` | Escape hatch: subpaths (the part after `@scope/pkg/`) permitted despite reaching past the barrel, e.g. `['package.json', 'jsx-runtime']`. Matched exactly. |

`scopes` is **required** and has **no default**, so the rule fires nothing until you tell it which
scopes to guard. With an empty `scopes` array the rule matches nothing.

```js
'noctcore-monorepo/no-deep-package-imports': ['error', { scopes: ['@acme'] }]
```

## When not to use it

If your packages deliberately expose many public subpaths, prefer declaring them via each package's
`exports` map (and list any that should stay reachable under `allowedSubpaths`) rather than disabling
the rule wholesale.
