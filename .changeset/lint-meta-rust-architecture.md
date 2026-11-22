---
'@noctcore/lint-meta-rules': minor
---

Three new opt-in factories for Rust codebases, all text only (they never run cargo) and all listed in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` builds none of them:

- `createRustModuleShapeRule` (`rust-module-shape`): no `.rs` file over `maxCodeLines` code lines (blank, comment and `#[cfg(test)]` module lines excluded), and every `mod.rs` only declares and re-exports modules. Optional ratchet baseline through `baselineDir` (keys `size:<file>` and `manifest:<file>`), `advisoryCodeLines`, `manifestItems`, `exclude`.
- `createRustLayerRankRule` (`rust-layer-rank`): a layer may depend only on strictly lower-ranked layers. `module` mode ranks the top-level modules of one crate from `crate::` paths (grouped imports included) with `facades`, `toleratedGroups`, `forbiddenEdges` and `exempt`; `crate` mode ranks the crates of a workspace from `<prefix>_<crate>` paths and `<prefix>-<crate>` entries in `Cargo.toml`.
- `createRustCommandPlacementRule` (`rust-command-placement`): a command handler attribute (default `#[tauri::command]` or `#[command]`) only inside `allowIn` and never inside `denyIn`.

Comments, doc comments and string contents are never read, so documentation that names a banned edge or spells the attribute is not reported.
