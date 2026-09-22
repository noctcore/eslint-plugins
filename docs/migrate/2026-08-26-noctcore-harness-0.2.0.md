# Migration Plan: @noctcore/harness 0.1.0 → 0.2.0

**Date:** 2026-08-26
**Agent:** kirei-migrate
**Target:** `@noctcore/harness` `0.1.0` → `0.2.0` (consumed by `@noctcore/lint-meta-rules` as a `dependencies` entry)
**Source repo:** github.com/noctcore/nightcore, `packages/harness` (harness ships from a different repo than this monorepo)
**Migration guide:** none published (no CHANGELOG.md in the npm tarball, no GitHub release notes found); this plan is derived from a direct diff of the two published npm tarballs' `dist/*.d.ts` and `dist/*.js`/`dist/*.cjs` files, plus the README diff.

## Summary

`@noctcore/harness` is declared **only** in `packages/lint-meta-rules/package.json`, as `"@noctcore/harness": "^0.1.0"` under `dependencies`. Pre-1.0 caret ranges do not cross minors, so `^0.1.0` does not admit `0.2.0` — a manifest edit is mandatory to pick up the new version at all. No other workspace package depends on `@noctcore/harness` or on `@noctcore/lint-meta-rules`, so the blast radius is fully contained to this one package.

**The actual API surface consumed by `lint-meta-rules/src/` (`IMetaRule`, `IViolation`, `IMetaCtx` as types; `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline` as runtime values) is BYTE-IDENTICAL between harness 0.1.0 and 0.2.0.** Diffing the published tarballs confirms `dist/index.js` and `dist/index.cjs` are 100% unchanged, and `dist/index.d.ts` is textually identical for every exported symbol (only an internal bundler chunk filename hash differs, which is not part of the public contract). All real changes in 0.2.0 live in the **CLI** (`dist/cli.js` / `dist/cli.d.ts`) and its internal `ManifestOutcome` type — files/exports `lint-meta-rules` never imports.

This is consequently the lowest-risk class of migration: a **mechanical dependency-range edit** with **zero behavioral changes** to verify. Recommended cadence: single small PR/commit, no staging needed.

**Recommended `@noctcore/lint-meta-rules` version bump: PATCH (0.1.0 → 0.1.1), with a changeset.** See "Version Bump Decision" below.

## Harness 0.1.0 → 0.2.0 — What Actually Changed (full diff, for completeness)

All changes are in the CLI binary (`harness` bin), not the library surface:

1. **New `--manifest <path>` CLI flag** for `harness check` — lets a caller point at an explicit manifest file instead of the default `.nightcore/harness.json`. An explicitly-named manifest that is missing/unparseable now fails closed (`unreadable-manifest` outcome, exit 1) instead of silently treating it as "no config" (exit 0). Default (no `--manifest`) behavior is unchanged.
2. **New `ManifestOutcome` variant**: `{ kind: 'unreadable-manifest', path: string, reason: string }` added to the union (only reachable via explicit `--manifest`/`--registry`). This is exported from `dist/index.d.ts` transitively via the `run-*.js` chunk, but `lint-meta-rules` never imports `ManifestOutcome`.
3. **New `harness lint-meta --registry <path>` CLI subcommand behavior**: default registry lookup now tries `.nightcore/lint-meta/registry.mts` → `.../registry.ts` → `.../registry.js` (was `.../registry.js` only), and TypeScript registries load via Node's native type-stripping (requires Node ≥ 22.18, one bump from the existing `>=22` floor — but only when a *downstream consumer* points harness's CLI at a `.ts`/`.mts` registry; irrelevant to how `lint-meta-rules` itself is built/tested).
4. **Friendlier import-error messages** in the CLI's registry loader (`describeImportError`) for common misconfigurations (wrong Node version, node_modules type-stripping restriction, ESM/CJS mismatch).
5. `package.json`: version bump only. No new `dependencies`, `peerDependencies` (harness has zero deps/peers in both versions — confirmed via `npm view @noctcore/harness@0.1.0` / `@0.2.0`, both report "deps: none"), `engines` (`node >=22` unchanged), or `exports`/`bin` shape changes.

**None of items 1–4 touch `IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, or `loadBaseline` — the six symbols `lint-meta-rules` imports.**

## Pre-flight Requirements

- Runtime: Node `>=22` unchanged in both harness versions — **no Node bump required** for this migration. (Node ≥22.18 is only needed by a *downstream consumer* who points the harness CLI at a TypeScript `lint-meta` registry; `lint-meta-rules` does not do this — it ships a compiled JS/CJS library, not a registry file consumed via the harness CLI.)
- Peer deps: none. `npm view @noctcore/harness@0.2.0` reports `deps: none` and there is no `peerDependencies` block in either version's `package.json`.
- Other plugins/packages to upgrade in lockstep: none. `grep -rln "@noctcore/harness" packages/*/package.json` returns only `packages/lint-meta-rules/package.json`.

## Breaking Changes & Call Sites

No breaking changes affect the consumed surface. For completeness, the six import sites were enumerated and each confirmed unaffected:

### BC-1 — Dependency manifest range does not admit the new version
**Type:** Structural (packaging, not code)
**File:** `packages/lint-meta-rules/package.json:49`
**Current:** `"@noctcore/harness": "^0.1.0"`
**Fix:** `"@noctcore/harness": "^0.2.0"`
**Why this is the crux:** pre-1.0 semver caret ranges (`^0.x.y`) only admit patch bumps within the same minor (`0.1.z`), never `0.2.0`. Without this edit, `bun install` (even non-frozen) will keep resolving `0.1.0` forever; the new version is simply unreachable.

### BC-2 (non-breaking, verified) — Type-only imports: `IMetaRule`, `IViolation`, `IMetaCtx`
**Type:** N/A — confirmed unchanged
**Call sites:**
- `IMetaRule`: `src/rules/{canonical-helpers-single-home,no-cloned-component-folders,no-warn-severity,ui-primitive-shape,test-runner-segregation,test-workspace-enrollment,file-size-ratchet,workspace-graph-parity,agents-doc-presence,test-sibling-enforcement,layer-rank,package-shape,index}.ts` (13 files)
- `IViolation`: same list minus `src/rules/index.ts` (12 files)
- `IMetaCtx`: `src/rules/file-size-ratchet.ts:1` (src), plus `tests/test-utils/createFakeCtx.ts:1` (test helper, outside the stated src scope but confirmed identically unaffected)
**Verification:** `interface IMetaCtx`, `interface IViolation`, `interface IMetaRule` in `dist/index.d.ts` are character-for-character identical between 0.1.0 and 0.2.0 tarballs (diffed directly).
**Fix:** none required.

### BC-3 (non-breaking, verified) — Runtime-value imports: `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline`
**Type:** N/A — confirmed unchanged
**Call site:** `src/rules/file-size-ratchet.ts:1-2` — the ONLY file in `src/` that imports runtime values from harness (highest-risk file per the task brief; verified lowest-risk in practice)
**Verification:** `dist/index.js` and `dist/index.cjs` are byte-identical between the 0.1.0 and 0.2.0 tarballs (`diff` produced zero output for both). The `DEFAULT_BASELINE_DIR` constant string, `loadBaseline()` implementation, and `isGrandfathered()` implementation are unchanged.
**Fix:** none required.

## Codemods Available

None needed — this is a single-line manifest edit, not a rename/API migration. No codemod exists or is applicable.

## Lockfile Mechanics — IMPORTANT (Bun-specific hazard)

`bun update` is **not** lockfile-safe on this repo's pinned `bun@1.3.14`: it has been observed rewriting *unrelated* published manifest fields on other packages during an unrelated safe-bump pass earlier in this session (e.g. narrowing a published `peerDependencies.eslint` range from `">=9.0.0"` to `"^10.7.0"`) — an unacceptable, silent, consumer-breaking side effect for a scoped dependency bump. **Do not run `bun update` for this migration.**

**Verified-safe procedure** (validated end-to-end in an isolated `/tmp` scratch copy of this repo during research — not applied to the working tree):

1. Manually edit **only** `packages/lint-meta-rules/package.json:49`: `"@noctcore/harness": "^0.1.0"` → `"^0.2.0"`.
2. Run plain `bun install` (no flags) from the repo root. This regenerates `bun.lock` to match the manifest and does **not** touch any other `package.json` in the workspace.
3. Confirmed via `md5` comparison of every `package.json` in the tree before/after: **only** `packages/lint-meta-rules/package.json` changed (the one line from step 1). No other manifest — root or any sibling package — was touched.
4. `bun.lock` diff is minimal and exactly as expected — two lines change:
   ```diff
   -        "@noctcore/harness": "^0.1.0",
   +        "@noctcore/harness": "^0.2.0",
   ...
   -    "@noctcore/harness": ["@noctcore/harness@0.1.0", "", { "bin": { "harness": "dist/cli.js" } }, "sha512-bGQQ8neXh2ovKf350zeVK0ZLtQgL8KZn09mU18q1VtxWX7LAWcfecD/1xSAkcxDiGRwpXH9PMPjyRhcjYZiZaQ=="],
   +    "@noctcore/harness": ["@noctcore/harness@0.2.0", "", { "bin": { "harness": "dist/cli.js" } }, "sha512-tNI9fKRc+oUwgptn/XmGVv1RaAR3FZNRwPBYV41VbQkZKr7F5FoeN/Yw/plv3L+phGN3BK+dXjlODEx3QX/7UQ=="],
   ```
   (The sha512 for `harness@0.2.0` above was independently confirmed against `npm view @noctcore/harness@0.2.0` / the registry tarball's `.integrity` field, so it can be hand-verified if `bun install` output ever needs cross-checking.)
5. After the lockfile is regenerated, `bun install --frozen-lockfile` (the exact command CI runs) passes clean with "no changes" — confirming the new lockfile is internally consistent and CI-ready.

**Why the lockfile edit is non-optional:** CI runs `bun install --frozen-lockfile` as its first step. If the manifest is edited but `bun.lock` is not regenerated and committed in the same change, CI fails immediately at install, before build/typecheck/test ever run.

## Upgrade Order

1. Edit `packages/lint-meta-rules/package.json:49` — bump the `@noctcore/harness` range to `^0.2.0`. (No peer/runtime pre-flight steps needed — none apply per "Pre-flight Requirements" above.)
2. Run `bun install` (plain, not `bun update`) at the repo root to regenerate `bun.lock`. Verify the diff touches only the two `@noctcore/harness` lines (workspace-deps block + resolved-packages block) — if it touches anything else, stop and investigate before proceeding (that would indicate the lockfile was stale/drifted from something else, not from this change).
3. Commit `packages/lint-meta-rules/package.json` and `bun.lock` together (a lockfile-only or manifest-only commit would leave CI's `--frozen-lockfile` step failing on the intermediate state).
4. Add a changeset for `@noctcore/lint-meta-rules` (patch bump — see "Version Bump Decision").
5. Run the full CI gate locally before pushing: `bun install --frozen-lockfile && bun run build && bun run typecheck && bun run test` (root-level, across all workspace packages — confirmed clean in the scratch validation).

No plugin/extension bumps are needed (step 5 from the standard template is not applicable — harness has no dependent plugins in this repo).

## Verification

All four gate commands were run end-to-end in an isolated `/tmp` scratch copy with the manifest+lockfile changes applied (not in the working tree — the working tree's pre-existing uncommitted `bun.lock` change from the prior safe-bump pass was left untouched):

- `bun install --frozen-lockfile` → clean, "no changes" against the regenerated lockfile.
- `bun run build` (root, all packages) → clean, `@noctcore/lint-meta-rules` emits `dist/index.js` (27.11 KB), `dist/index.cjs` (29.04 KB), `dist/index.d.ts`/`dist/index.d.cts` (20.51 KB) — same sizes as before the bump (build output unaffected, as expected since harness's runtime/types are unchanged).
- `bun run typecheck` (root, all packages) → clean, 0 errors, including `@noctcore/lint-meta-rules`.
- `bun run test` for `@noctcore/lint-meta-rules` (`bun test`) → **84 pass / 0 fail**, 166 `expect()` calls across 13 test files — including `tests/rules/file-size-ratchet.test.ts`, the test exercising the runtime-value imports (`DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline`).

No smoke test beyond the standard suite is warranted — there is no behavioral change to smoke-test against (see BC-2/BC-3 verification above).

## Version Bump Decision — `@noctcore/lint-meta-rules`

**Does this require a version bump of `@noctcore/lint-meta-rules`?** Yes.
**What kind?** **Patch** (`0.1.0` → `0.1.1`).
**Should a changeset be created?** Yes.

Reasoning:
- `@noctcore/lint-meta-rules@0.1.0` is published on npm (`npm view` confirms it matches the working tree's `0.1.0` and currently declares `"@noctcore/harness": "^0.1.0"` in its published `dependencies`). Any edit to a published package's manifest that ships to consumers — including a `dependencies` range — is consumer-visible and must go through a release, per this repo's Changesets-driven flow (`.changeset/config.json` has `"commit": false`, `"access": "public"`; releases happen via `changeset version` + `changeset publish` in CI). Silently editing the manifest without a changeset would mean the next `changeset version` run either misses this change entirely or the repo ships an unreleased manifest drift.
- **Patch, not minor or major**, because:
  - No public API of `@noctcore/lint-meta-rules` itself changes — no new exports, no signature changes, no rule behavior changes (confirmed: `IMetaRule`/`IViolation`/`IMetaCtx` and the three runtime functions are byte-identical in the new harness version, and the full test suite is unchanged and green).
  - The change is a maintenance-only dependency-range widening, not a new feature and not a fix to a defect — the closest semver-conscious characterization is "chore(deps)", which by convention (and by this repo's own `.changeset/config.json` → `"updateInternalDependencies": "patch"`, signaling the project's general philosophy that dependency-range bumps are patch-level even though that setting technically governs workspace-internal deps, not this external one) maps to patch.
  - It is not currently a *broken* state — harness `0.1.0` remains published and installable indefinitely, so existing installs of `lint-meta-rules@0.1.0` keep working exactly as before. This is a proactive upgrade, reinforcing that it's not fix-worthy (which might argue patch-for-a-different-reason) or feature-worthy (minor) — it is routine maintenance.
- **Changeset content** (add as `.changeset/<slug>.md`):
  ```markdown
  ---
  "@noctcore/lint-meta-rules": patch
  ---

  Bump the `@noctcore/harness` dependency range to `^0.2.0`. No consumed API changed (types and runtime exports used by this package — `IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline` — are unchanged between harness 0.1.0 and 0.2.0); this only widens the resolvable dependency range.
  ```

## Rollback

- **Pre-merge:** revert the two changed lines (`package.json` dependency range, `bun.lock` resolved entry) and drop the changeset file. Trivial single-commit revert.
- **Post-merge, pre-publish:** same as above — `changeset version` has not run yet, so no npm version was consumed.
- **Post-publish (if `lint-meta-rules@0.1.1` ships and something unexpected surfaces downstream):** harness `0.1.0` remains published indefinitely on npm (registry `versions` list confirms both `0.1.0` and `0.2.0` are still present), so reverting is safe at any point — either publish a `0.1.2` that reverts the range to `^0.1.0`, or have consumers pin `@noctcore/lint-meta-rules@0.1.0` directly. No data/schema migration, no irreversible state — this is a pure dependency-range change.

## Out of Scope

- Upgrading the harness CLI's own dependents/consumers outside this repo (this repo is not the harness source repo; harness ships from `github.com/noctcore/nightcore`).
- Adopting the new `harness --manifest <path>` / `harness lint-meta --registry <path>` CLI capabilities added in 0.2.0 — `lint-meta-rules` is a library of rule factories, not a CLI consumer of `harness`; it has no code path that invokes the harness CLI at all, so there is nothing to adopt.
- The already-in-flight, unrelated `bun.lock` changes from the prior safe-bump pass (postcss, nanoid, brace-expansion, js-yaml, `@typescript-eslint/*` 8.63.0→8.68.0, `@changesets/cli`) — left untouched by this research; the harness bump should be applied as an additive edit on top of that existing uncommitted lockfile state, not by discarding it.

---

## Outcome — applied 2026-08-26

`packages/lint-meta-rules/package.json`: `"@noctcore/harness": "^0.1.0"` → `"^0.2.0"` (single line). Lockfile updated via plain `bun install`; the new entry's `sha512` was checked against `npm view @noctcore/harness@0.2.0 dist.integrity` and matches exactly. Changeset `.changeset/bump-noctcore-harness-0-2-0.md` queues `@noctcore/lint-meta-rules` **patch** (0.1.0 → 0.1.1).

Independent re-verification of the "API unchanged" claim (both tarballs fetched and diffed directly):
- `dist/index.js` — **byte-identical** between 0.1.0 and 0.2.0.
- `dist/index.d.ts` — differs only in a hashed chunk filename (`run-B6_KI2bV` → `run-DALdooYG`), a build artifact, not an API change.
- All six consumed symbols (`IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline`) — declarations identical across versions.
- **Correction to the research claim:** the type chunk is *not* byte-identical. `ManifestOutcome` gained an `unreadable-manifest` union variant. That symbol is not imported by `lint-meta-rules`, so the conclusion stands — but a consumer doing an exhaustive `switch` over `ManifestOutcome` would see a breaking change.

Gates green: frozen-lockfile install, build, typecheck, 602 vitest + 84 bun tests.
