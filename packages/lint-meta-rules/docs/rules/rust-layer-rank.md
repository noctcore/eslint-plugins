# `rust-layer-rank`

> A Rust module or crate may depend only on layers of a strictly lower rank: modules from `crate::` paths, crates from paths and `Cargo.toml` dependencies.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createRustLayerRankRule` from `@noctcore/lint-meta-rules` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A layered Rust codebase stays layered only while every edge points down. One sideways `use` between
two modules of the same tier, or a crate that picks up a dependency on a crate above it, is how the
layering quietly turns into a cycle that the compiler accepts. Ranking the layers and checking every
edge from text keeps the direction visible and enforced, without running cargo.

### Opt-in

The rule is in `RULE_FACTORIES` and in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` skips it. With
no `ranks` and no `forbiddenEdges` it reports nothing. Enable it by naming it in `optIn` with options
through the factory:

```ts prose
import { createRustLayerRankRule } from '@noctcore/lint-meta-rules';

// One crate, ranked by top-level module.
const modules = createRustLayerRankRule({
  root: 'apps/desktop/src-tauri/src',
  ranks: { types: 1, io: 1, storage: 2, engine: 3, worker: 3, commands: 4 },
  facades: { settings: 'storage' },
  toleratedGroups: [['engine', 'worker']],
  forbiddenEdges: [{ from: 'worker', to: 'engine', message: 'worker reaches the engine only through the Dispatch trait.' }],
  exempt: ['**/tests.rs', 'apps/desktop/src-tauri/src/bindings/**'],
});

// A workspace, ranked by crate.
const crates = createRustLayerRankRule({
  mode: 'crate',
  cratePrefix: 'acme',
  ranks: { core: 0, net: 1, db: 2, library: 3, desktop: 99 },
  roots: ['crates', 'apps/desktop/src-tauri/src'],
  manifestGlobs: ['crates/*/Cargo.toml', 'apps/desktop/src-tauri/Cargo.toml'],
  crateDirs: { 'apps/desktop/': 'desktop' },
});
```

## What it flags

An edge from a ranked layer to a layer of equal rank (sideways) or higher rank (upward), one
violation per file and target, at the first edge to it.

`module` mode (the default) ranks the top-level modules of one crate. A file's layer is its first
path segment under `root` (`src/store/task.rs` and `src/store.rs` are both `store`). Its edges are
`crate::x` paths, the names in a grouped `use crate::{x, y::z}`, and `super::` paths that climb to
the crate root, after `facades` maps a crate-root alias to the module it re-exports. Leading
`super::` segments are resolved from the file's module depth under `root`: `lib.rs` and `main.rs`
are the root, `foo.rs` and `foo/mod.rs` are depth 1, `foo/bar.rs` is depth 2. So `use super::ui::Widget`
in `src/store.rs` is `crate::ui::Widget`, and so is `use super::super::ui::Widget` in
`src/store/task.rs`. A grouped import is read up to its closing brace, a `;`, or 4096 characters. Equal-rank edges inside one of `toleratedGroups` are allowed (a
known cycle), and `forbiddenEdges` are reported whatever the ranks say, with their own message.

```rust
// ranks: { types: 1, storage: 2, engine: 3 }

// Bad: src/storage/files.rs
use crate::engine::Runner;

// Good: src/storage/files.rs
use crate::types::Id;
```

`crate` mode ranks the crates of a workspace. A file belongs to `crates/<prefix>-<name>/` or to a
`crateDirs` prefix. Its edges in Rust source are `<prefix>_<name>` paths (`acme_db::Pool`,
`::acme_db::Pool`) and `use` / `extern crate` declarations (`use acme_db;`); a name that only starts
with the prefix (`acme_db_url`) or a submodule of that name (`foo::acme_db`) is not an edge. In a
`Cargo.toml` matched by `manifestGlobs`, its edges are the entries of a dependency table
(`[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[target.<cfg>.dependencies]`):
bare, quoted or dotted keys (`acme-db = ...`, `"acme-db" = ...`, `acme-db.workspace = true`),
`[dependencies.acme-db]` table headers, and renamed dependencies, which count as the package they
name (`db = { package = "acme-db" }`).

```toml
# ranks: { core: 0, db: 2 }

# Bad: crates/acme-core/Cargo.toml
[dependencies]
acme-db = { path = "../acme-db" }

# Good: crates/acme-db/Cargo.toml
[dependencies]
acme-core = { path = "../acme-core" }
```

A second instance with its own `id`, no `ranks` and one forbidden edge is a dedicated seam guard:
`createRustLayerRankRule({ id: 'worker-seam', forbiddenEdges: [{ from: 'worker', to: 'engine' }] })`.

## What it does not flag

- A layer that is not in `ranks`, on either side (unless an edge from it is in `forbiddenEdges`).
- Edges inside one layer, and edges to a lower rank.
- Paths in comments, doc comments and string literals, and inside `#[cfg(test)]` modules (unless
  `skipTestModules` is `false`).
- `self::` paths, and `super::` paths that stay below the crate root (inside the file's own
  top-level module). The depth comes from the file path, so an inline `mod name { ... }` block does
  not add a level.
- `facades` keys are read as own keys only: a module named `constructor` is not looked up on the
  object prototype.
- Files matching `exempt` (a composition root, a bindings aggregator, `tests.rs`).

## Options

```ts
createRustLayerRankRule(options?: RustModuleRankOptions | RustCrateRankOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | `'module' \| 'crate'` | `'module'` | Rank modules of one crate or crates of a workspace. |
| `id` | `string` | `'rust-layer-rank'` | Rule id. |
| `ranks` | `Record<string, number>` | `{}` | Layer name to rank. |
| `forbiddenEdges` | `{ from, to, message? }[]` | `[]` | Edges always reported. |
| `exempt` | `string[]` | `[]` | Globs of files never checked as the importing side. |
| `skipTestModules` | `boolean` | `true` | Leave `#[cfg(test)] mod` blocks out of the scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |
| `root` | `string` | `'src'` | Module mode: the crate's source directory. |
| `facades` | `Record<string, string>` | `{}` | Module mode: crate-root alias to the module it re-exports. |
| `toleratedGroups` | `string[][]` | `[]` | Module mode: equal-rank modules allowed to import each other. |
| `cratePrefix` | `string` | required | Crate mode: the shared crate name prefix. |
| `roots` | `string[]` | `['crates']` | Crate mode: directories whose `.rs` files are scanned. |
| `manifestGlobs` | `string[]` | `['crates/*/Cargo.toml']` | Crate mode: `Cargo.toml` files whose dependency keys are checked. |
| `crateDirs` | `Record<string, string>` | `{}` | Crate mode: path prefix to crate name for crates outside `crates/<prefix>-<name>/`. |

## When not to use it

The rule reads paths, not the module tree: a `use` through a re-export that `facades` does not list
is ranked by the alias name, and a macro that expands to a `crate::` path is not seen. Crate mode
reads dev-dependencies the same as dependencies, so a test-only dependency on a higher crate is
reported; exempt that `Cargo.toml` if it is deliberate.

## Related

- [`layer-rank`](./layer-rank.md) does the same for TypeScript workspace packages.
- [`rust-module-shape`](./rust-module-shape.md) and [`rust-command-placement`](./rust-command-placement.md)
  share the comment and test-module handling.
