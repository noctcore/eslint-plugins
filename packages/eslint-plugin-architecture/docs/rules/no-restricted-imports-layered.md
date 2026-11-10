# `noctcore-architecture/no-restricted-imports-layered`

> Import bans declared once as named sets and assigned to file layers, merged per file instead of overridden, covering static imports, re-exports and dynamic `import()`.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Flat config does not merge `no-restricted-imports` across config blocks. For a given file, the last
matching block's options replace every earlier block's. A repo that bans an SDK everywhere and then
adds a layer ban for one directory has to repeat the SDK ban inside the layer block, and the copies
drift apart. The built-in rule also never sees a dynamic `import()`, so the same bans get written a
second time as `no-restricted-syntax` selectors.

This rule takes the bans once, as named sets, and the layers as a list of `files` / `ignores` globs
that name the sets they apply. Every layer that matches a file contributes its sets, so bans merge
instead of overriding one another.

### In `recommended`

Left out of `recommended`. The rule does nothing without your own ban sets and layers, so there is no
default the preset could enable.

## What it flags

An import of a module that a ban set active for the file names, on every source-carrying construct:

- static `import … from '…'`, including a side-effect `import '…'`
- `export … from '…'` and `export * from '…'`
- dynamic `import('…')` with a string or a plain template literal

A module glob matches the specifier or any parent path of it, the way a `no-restricted-imports`
group does: `@/features` bans `@/features/billing`, and an SDK name bans its subpath exports.

```ts bad filename=src/lib/prefetch.ts reports=3 options={"bans":{"noFeatures":[{"modules":["@/features","**/features"],"message":"Move the shared piece down a layer."}],"noRoutes":[{"modules":["@/routes","**/routes"]}]},"layers":[{"files":["src/lib/**"],"bans":["noFeatures","noRoutes"]}]}
import { InvoiceList } from '@/features/billing';
import { useInvoice } from '../features/billing/hooks';
const screen = await import('@/routes/invoices');
```

Two layers that match the same file both apply. Here the engine core may use neither SDK, while each
provider folder is exempt from its own SDK's ban only:

```ts bad filename=packages/engine/src/session/run.ts reports=2 options={"bans":{"claude":[{"modules":["@anthropic-ai/claude-agent-sdk"]}],"codex":[{"modules":["@openai/codex-sdk"]}]},"layers":[{"files":["packages/engine/src/**"],"ignores":["packages/engine/src/providers/claude/**"],"bans":["claude"]},{"files":["packages/engine/src/**"],"ignores":["packages/engine/src/providers/codex/**"],"bans":["codex"]}]}
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Codex } from '@openai/codex-sdk';
```

With `importNames`, only those names are banned, each reported where it is imported. A namespace
import (`import * as`) and `export *` always count:

```ts bad filename=src/lib/query.ts reports=1 options={"bans":{"legacy":[{"modules":["@tanstack/react-query"],"importNames":["useQueries"]}]},"layers":[{"files":["src/**"],"bans":["legacy"]}]}
import { useQueries, useQuery } from '@tanstack/react-query';
```

## What it does not flag

- Files no layer matches, and files a layer's `ignores` excludes from it.
- With `allowTypeImports`, `import type`, `export type` and inline `type` specifiers. An import that
  mixes a type specifier with a value specifier is still reported.
- A module whose name only starts with a banned one (`@openai/codex-sdk-mock` against
  `@openai/codex-sdk`).
- A dynamic `import()` whose specifier is computed, since it cannot be resolved statically. A name
  ban never applies to a dynamic import, since the names it reaches are unknown.
- Anything, without options.

```ts bad filename=src/features/billing/client.ts reports=2 options={"bans":{"api":[{"modules":["@api/*"],"allowTypeImports":true}]},"layers":[{"files":["src/**"],"bans":["api"]}]}
import { appRouter } from '@api/trpc';
import { type InvoiceInput, createInvoice } from '@api/billing';
```

```ts good filename=src/features/billing/client.ts options={"bans":{"api":[{"modules":["@api/*"],"allowTypeImports":true}]},"layers":[{"files":["src/**"],"bans":["api"]}]}
import type { AppRouter } from '@api/trpc';
import { type InvoiceInput } from '@api/billing';
```

Relative and aliased spellings are different strings, so list both: `@/features` for the alias and a
glob starting with `**` (`**/features`) for the relative form.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `bans` | `Record<string, Ban[]>` | `{}` | Named ban sets, declared once and referenced by name from `layers`. |
| `layers` | `Layer[]` | `[]` | Which ban sets apply where. Every layer matching a file adds its sets. |

A `Ban`:

| Field | Type | Meaning |
| --- | --- | --- |
| `modules` | `string[]` | Globs matched against the specifier or any of its parent paths. Required. |
| `importNames` | `string[]` | Ban only these names (`default` for the default import). |
| `allowTypeImports` | `boolean` | Allow type-only imports and specifiers. |
| `message` | `string` | Appended to the report, usually what to import instead. |

A `Layer`:

| Field | Type | Meaning |
| --- | --- | --- |
| `files` | `string[]` | File globs the layer applies to, read relative to the working directory like flat-config `files`. A glob starting with `**/` also matches the absolute path. Required. |
| `ignores` | `string[]` | File globs excluded from the layer. |
| `bans` | `string[]` | Names of the ban sets that apply. A name `bans` does not declare is a configuration error. Required. |

```js
'noctcore-architecture/no-restricted-imports-layered': ['error', {
  bans: {
    claudeSdk: [{ modules: ['@anthropic-ai/claude-agent-sdk'], message: 'Only the claude provider talks to the SDK.' }],
    noFeatures: [{ modules: ['@/features', '**/features'] }],
    apiTypeOnly: [{ modules: ['@api/*'], allowTypeImports: true }],
  },
  layers: [
    { files: ['apps/**', 'packages/**'], ignores: ['packages/engine/src/providers/claude/**'], bans: ['claudeSdk'] },
    { files: ['apps/web/src/lib/**'], bans: ['noFeatures', 'apiTypeOnly'] },
  ],
}]
```

## When not to use it

If one `no-restricted-imports` block per file is enough, because no file sits under two layers with
different bans and you have no dynamic imports to cover, the built-in rule is simpler.
