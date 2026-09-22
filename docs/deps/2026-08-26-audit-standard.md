# Dependency Safety Report

**Date:** 2026-08-26
**Agent:** kirei-deps
**Depth:** standard
**Package manager:** bun (bun@1.3.14, `bun.lock`)
**Scope:** Bun workspace monorepo — root (private, build tooling only) + 11 workspace packages under `packages/*`

## Summary

`bun audit` found 7 advisories (5 high, 1 moderate, 1 low) across 6 distinct GHSAs, **all transitive**, all pulled in via the shared build/test toolchain (`tsup`, `vitest`, `eslint`/`@typescript-eslint/*`, `@changesets/cli`) that every workspace package depends on identically. GitHub Dependabot currently shows **0 open alerts** (alerts are enabled on the repo, so this is a real gap between what Dependabot has scanned and what `bun audit` finds locally — do not treat "0 Dependabot alerts" as "clean"). 5 of the 6 GHSAs are fixable today with a lockfile-only `bun update` (no `package.json` edits); the 6th (esbuild, low severity) is currently blocked because `tsup@8.5.1` pins `esbuild: ^0.27.0`, which excludes the fixed `0.28.1`. Manual cross-referencing against the GitHub Advisory API also turned up a vulnerable `js-yaml@4.3.0` (pulled in via `@changesets/cli` → `@changesets/parse`) that `bun audit` did **not** surface — see Tool Gaps. Separately, the workspace's own direct/dev dependency versions are already unusually consistent (no drift) across all 11 packages, and there's a small batch of drift-closing minor/patch bumps available.

## Audit Results

| Severity | Count | Direct | Transitive |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 5 | 0 | 5 |
| Moderate | 1 | 0 | 1 |
| Low | 1 | 0 | 1 |

(Counts as reported by `bun audit`. brace-expansion and js-yaml each contribute 2 line-items — two separate GHSAs for brace-expansion, and one GHSA shown against two require-paths for js-yaml — hence 7 line-items for 6 distinct GHSAs.)

### High / Moderate / Low Findings

| Package | Resolved | Vulnerable Range | Fixed In | GHSA | Severity | Direct? | Pulled in by |
|---|---|---|---|---|---|---|---|
| `brace-expansion` | 5.0.7 | `>=4.0.0 <5.0.8` | 5.0.8 | GHSA-mh99-v99m-4gvg | high | no | `minimatch` ← `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/rule-tester`, `@typescript-eslint/typescript-estree` (via `@typescript-eslint/utils`) |
| `brace-expansion` | 5.0.7 | `>=4.0.0 <5.0.9` | 5.0.9 | GHSA-rgw5-rvv9-x895 | high | no | same as above (bypasses the first mitigation — need 5.0.9, not just 5.0.8) |
| `nanoid` | 3.3.16 | `<3.3.18` | 3.3.18 | GHSA-2v37-7h3g-55p8 | high | no | `postcss` ← `tsup`, `vite` (via `vitest`) |
| `js-yaml` | 3.15.0 | `>=3.0.0 <3.15.1` | 3.15.1 | GHSA-5p4m-2wfm-xmqj | high | no | `read-yaml-file` ← `@manypkg/get-packages` ← `@changesets/cli` |
| `postcss` | 8.5.18 | `<=8.5.22` | 8.5.23 | GHSA-fxqj-rqcc-2cmp | moderate | no | `tsup`, `vite` (via `vitest`) |
| `esbuild` | 0.27.7 | `>=0.27.3 <0.28.1` | 0.28.1 | GHSA-g7r4-m6w7-qqqr | low | no | `tsup` |

All of the above resolve identically wherever they occur — `bun audit` only prints the first alphabetical workspace match (`eslint-plugin-architecture`), but the same shared devDependency set (`tsup`, `vitest`, `@typescript-eslint/*`, `eslint`) is duplicated verbatim across all 8 `eslint-plugin-*` packages plus `eslint-utils` (tsup) and `eslint-test-utils` (`@typescript-eslint/parser`/`rule-tester`), so this is a single fix applied once at the lockfile level, not 8 separate fixes.

**Impact notes:**
- All 6 GHSAs live entirely in dev/build tooling (bundler, test runner, linter internals, release CLI). None of it ships in the published `dist/` of any `@noctcore/*` package — no supply-chain exposure to consumers of these ESLint plugins. Risk is to your CI/dev machines only (DoS/CPU exhaustion for the two `brace-expansion` GHSAs and the `js-yaml` GHSAs; arbitrary `.map` file read for the PostCSS one; infinite loop for `nanoid` with `size: 0` custom generators — none of these are exploitable by external input in this repo's normal build/test/release flow).
- **Resolution path:** `postcss`, `brace-expansion`, `nanoid`, and both `js-yaml` findings are all bumpable via a plain `bun update` (lockfile-only refresh) — every parent package's declared range already permits the fixed version (`minimatch@10.2.5` allows `brace-expansion@^5.0.5`, `postcss` peer ranges allow up to `<9.0.0`, `read-yaml-file` allows `js-yaml@^3.6.1`, `@changesets/parse` allows `js-yaml@^4.1.1`). No `package.json` edits needed for these 5.
- **`esbuild` is the exception:** `tsup@8.5.1` declares `"esbuild": "^0.27.0"` as a hard dependency (not a peer), which excludes `0.28.1`. `bun update` will **not** clear this one. As of this scan, `tsup@8.5.1` is also the current npm-latest `tsup` — there is no newer `tsup` release yet that widens the esbuild range. Given severity is low (Windows-only, dev-server-only, arbitrary `.map`/file read; this repo's CI runs on `ubuntu-latest`), recommend **deferring** rather than forcing a `bun` `overrides` pin on `esbuild@0.28.1` underneath `tsup` — that's an unsupported combination and could destabilize the build. Track for the next `tsup` release.

## Dependabot Alerts

`gh auth status` is authenticated (user `Shironex`) and `repos/noctcore/eslint-plugins/dependabot/alerts` returns **HTTP 200 with an empty array** — 0 open alerts. `vulnerability-alerts` is confirmed enabled (204) on the repo, so this isn't a permissions/feature-disabled issue — Dependabot's own scan simply hasn't (yet) flagged any of the 6 GHSAs `bun audit` found. Do not read "0 Dependabot alerts" as "nothing to do"; the local audit is more current here.

| GHSA | Package | Severity | Fixed In |
|---|---|---|---|
| — | — | — | (none open) |

## Safe Bumps

Two categories below: (A) transitive, CVE-driven, lockfile-only — no manifest changes, single `bun update`; (B) direct/dev manifest bumps, drift-closing, patch/minor, no CVE.

**(A) Transitive CVE fixes — `bun update` only, touches `bun.lock` alone:**

| Package | Current (resolved) | Target | Type | Resolves CVE? | Notes |
|---|---|---|---|---|---|
| `postcss` | 8.5.18 | 8.5.23 | patch | yes (GHSA-fxqj-rqcc-2cmp) | within existing peer ranges |
| `brace-expansion` | 5.0.7 | 5.0.9 | patch | yes (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895) | within `minimatch`'s declared range |
| `nanoid` | 3.3.16 | 3.3.18 | patch | yes (GHSA-2v37-7h3g-55p8) | within `postcss`'s declared range |
| `js-yaml` (3.x branch, via `read-yaml-file`) | 3.15.0 | 3.15.1 | patch | yes (GHSA-5p4m-2wfm-xmqj) | within `read-yaml-file`'s declared range |
| `js-yaml` (4.x branch, via `@changesets/parse`) | 4.3.0 | 4.3.1 | patch | yes (GHSA-5p4m-2wfm-xmqj) | **not flagged by `bun audit`** — found via manual GHSA cross-check, see Tool Gaps |
| `esbuild` | 0.27.7 | — (blocked) | — | no — not currently reachable | `tsup@8.5.1` pins `esbuild: ^0.27.0`; fix (0.28.1) is out of range. Defer until `tsup` bumps its esbuild dependency. |

**(B) Direct/dev manifest bumps — drift-closing, no CVE, all already within the declared caret range (pure `bun update`, no `package.json` edits required):**

| Package | Current (resolved) | Target | Type | Resolves CVE? | Notes | Where declared |
|---|---|---|---|---|---|---|
| `@typescript-eslint/utils` | 8.63.0 | 8.68.0 | minor | no | clean 8.x releases, within `^8.61.1` | direct dep in all 8 `eslint-plugin-*` + `eslint-utils` |
| `@typescript-eslint/parser` | 8.63.0 | 8.68.0 | minor | no | same release train as above, kept in lockstep | devDep in 8 `eslint-plugin-*`; direct dep in `eslint-test-utils` |
| `@typescript-eslint/rule-tester` | 8.63.0 | 8.68.0 | minor | no | same release train | devDep in 8 `eslint-plugin-*`; direct dep in `eslint-test-utils` |
| `@changesets/cli` | 2.31.0 | 2.31.1 | patch | no | within `^2.27.9` | root devDependency |

**Not safe / needs manual attention (excluded from the safe list, listed here for visibility):**

| Package | Current | Would-be target | Why not safe |
|---|---|---|---|
| `typescript` | 5.9.3 | 7.0.2 (latest) | Two majors ahead; already at the ceiling of `^5.6.0` so no auto-bump happens anyway. More importantly: `@typescript-eslint/typescript-estree@8.63.0` (a direct dependency across every plugin package) declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"` — bumping `typescript` past 6.0.x will break `typescript-eslint` compatibility repo-wide until `typescript-eslint` itself catches up. Do not bump ahead of `typescript-eslint`'s support window. |
| `vitest` | 3.2.7 | 4.1.11 (latest) | Major bump; already at ceiling of `^3`. Vitest 3→4 has historically included breaking changes to config/reporters. `eslint-test-utils` also declares `peerDependencies.vitest: "^3"`, so this needs a coordinated bump across every package's devDependency and `eslint-test-utils`'s peer range together. |
| `@types/node` | 22.20.1 | 26.3.0 (latest) | Major bump; already at ceiling of `^22.0.0`. `engines.node` in root `package.json` is `>=22` — bumping types to 26.x ahead of an actual Node engine bump is pure drift risk for no benefit. Low urgency. |
| `@changesets/changelog-github` | 0.5.2 | 1.0.0 (latest) | Major bump; already at ceiling of `^0.5.0`. Dev/release tooling only, no runtime exposure. Low urgency. |
| `@noctcore/harness` | 0.1.0 | 0.2.0 (latest) | `lint-meta-rules`' only dependency, pinned `^0.1.0` — since this is a pre-1.0 package, npm/bun caret semantics treat 0.1.0→0.2.0 as a **breaking** change by convention (not auto-installable; requires an explicit `package.json` range edit). Verify `@noctcore/harness`'s 0.2.0 changelog for breaking changes to the CLI/runner contract before bumping — this is the one dependency in the tree that isn't build/lint tooling, it's the actual runtime the package's rules execute under. |
| `eslint` (peer, unpinned) | 10.7.0 (resolved) | 10.9.1 (latest) | Not a manifest bump at all today — see Tool Gaps: `eslint` isn't declared as a `devDependency` anywhere in the workspace, only as an unbounded `peerDependencies.eslint: ">=9.0.0"` in every plugin package. Bun auto-installs a peer to satisfy `@typescript-eslint/rule-tester`'s test-time needs, currently landing on 10.7.0. This "works" but is unpinned and can drift silently between installs/CI runs. |

## Peer Dependency Currency (eslint / typescript / typescript-eslint)

Per the workspace-wide scope request:
- **`eslint` peer range** — `">=9.0.0"` (unbounded), identical across all 9 packages that declare it. Current npm-latest is `10.9.1`; the range already covers it and any future eslint 10.x/11.x releases with no further action needed. Current, no drift.
- **`typescript` peer range** — `">=5.0.0"` (unbounded), identical across all 9 packages. Currently fine (typescript-latest usable is effectively capped by `typescript-eslint`'s own `<6.1.0` support anyway — see the "Not safe" table above). This peer range is technically wider than what the toolchain can actually support once `typescript` 6.x/7.x lands broadly; not urgent, but worth tightening to `">=5.0.0 <6.1.0"` (or whatever `typescript-eslint`'s support window is at the time) the moment you bump `typescript-eslint` past its current ceiling, so consumers get an accurate signal instead of a false "should work" from bun/npm.
- **`typescript-eslint` (`@typescript-eslint/utils`)** — not a peer, it's a direct `dependencies` entry (`^8.61.1`) in every plugin package, resolved to `8.63.0` everywhere, safe-bumpable to `8.68.0` (see Safe Bumps). No drift between packages.
- **Cross-package drift check** — direct deps (`@noctcore/eslint-utils@^0.1.0`, `@typescript-eslint/utils@^8.61.1`), devDeps (`@typescript-eslint/parser@^8.61.1`, `@typescript-eslint/rule-tester@^8.61.1`, `tsup@^8.5.1`, `typescript@^5.6.0`, `vitest@^3`, `@types/node@^22.0.0`), and peerDeps (`eslint@>=9.0.0`, `typescript@>=5.0.0`) are byte-identical across all 8 `eslint-plugin-*` packages. **No drift found** — this repo is unusually well-kept on that front.

## Workspace Package Versions (for your own version-bump decision, not part of the dependency audit itself)

| Package | Current version |
|---|---|
| `@noctcore/eslint-plugin-architecture` | 0.2.0 |
| `@noctcore/eslint-plugin-async-safety` | 0.1.0 |
| `@noctcore/eslint-plugin-code-quality` | 0.1.0 |
| `@noctcore/eslint-plugin-contracts` | 0.2.0 |
| `@noctcore/eslint-plugin-monorepo` | 0.2.0 |
| `@noctcore/eslint-plugin-observability` | 0.1.0 |
| `@noctcore/eslint-plugin-react` | 0.2.0 |
| `@noctcore/eslint-plugin-security` | 0.1.0 |
| `@noctcore/eslint-test-utils` | 0.0.0 (private, unpublished) |
| `@noctcore/eslint-utils` | 0.1.0 |
| `@noctcore/lint-meta-rules` | 0.1.0 |

No pending changesets in `.changeset/` right now (only `README.md`/`config.json` present). If you want the safe-bump PR to also bump published versions, you'll need `bun run changeset` after `kirei-stitch` applies the dependency bumps — `updateInternalDependencies` in `.changeset/config.json` is set to `"patch"`, so internal `@noctcore/*` cross-deps auto-bump on release as expected.

## Tool Gaps Noted

- **`bun audit` missed a real vulnerable version.** Manual cross-check against the GitHub Advisory API (`gh api advisories/GHSA-5p4m-2wfm-xmqj`) shows the range `>=4.0.0 <4.3.1` (fixed `4.3.1`) for the js-yaml 4.x branch. The lockfile resolves `js-yaml@4.3.0` (pulled in via `@changesets/cli` → `@changesets/parse` → `js-yaml: ^4.1.1`) — that's inside the vulnerable range, but `bun audit`'s output only showed the 3.x-branch match (`read-yaml-file`'s nested `js-yaml@3.15.0`) and never surfaced the 4.x one. Treat `bun audit`'s output as a floor, not a ceiling, for this repo until confirmed otherwise on a future run.
- **`eslint` is not a declared dependency anywhere**, only an unbounded peer. Its concrete test-time version (currently `10.7.0`) is whatever bun's peer auto-install happens to land on at install time, not something pinned in any `package.json` or explicitly chosen. This isn't a CVE, but it's a reproducibility gap worth closing (see recommendation below).
- No Python/Rust/Go/Ruby audit tools were relevant — this is a pure Bun/TypeScript workspace, `bun audit` is the correct and complete tool for the JS dependency graph. `pip-audit`/`cargo audit`/`govulncheck`/`bundle audit` are all N/A here.

## Out of Scope

- Dependabot's own findings (there were none open to cross-reference against).
- Private/unpublished `eslint-test-utils` package's own runtime exposure — it's `"private": true` and never published, included here only for its contribution to the shared devDependency graph.
- Deep transitive-tree mapping and an ordered multi-phase upgrade plan (Phases 1–4) — those are `deep`-depth-only steps and were not run. If you want the risky majors (`typescript`, `vitest`, `@changesets/cli`/`changelog-github`, `@noctcore/harness`) sequenced with blast-radius ordering, re-run at `deep` depth.

---

## Outcome — safe bumps applied (2026-08-26)

**Result: 7 advisories → 1.** Working tree carries a `bun.lock`-only change (15 insertions, 15 deletions). No `package.json` in the repo was modified.

| Package | Before | After | Resolves |
|---|---|---|---|
| `brace-expansion` | 5.0.7 | 5.0.9 | GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 (high ×2) |
| `nanoid` | 3.3.16 | 3.3.18 | GHSA-2v37-7h3g-55p8 (high) |
| `js-yaml` (4.x, via `@changesets/parse`) | 4.3.0 | 4.3.1 | GHSA-5p4m-2wfm-xmqj (high) |
| `js-yaml` (3.x, via `read-yaml-file`) | 3.15.0 | 3.15.1 | GHSA-5p4m-2wfm-xmqj (high) |
| `postcss` | 8.5.18 | 8.5.23 | GHSA-fxqj-rqcc-2cmp (moderate) |
| `@typescript-eslint/{utils,parser,rule-tester}` | 8.63.0 | 8.68.0 | drift (+6 internal siblings in lockstep) |
| `@changesets/cli` | 2.31.0 | 2.31.1 | drift |

Remaining: `esbuild` GHSA-g7r4-m6w7-qqqr (low) — unreachable, `tsup@8.5.1` (npm-latest) hard-pins `esbuild: ^0.27.0`. Windows dev-server only; this repo has no dev server. Revisit when tsup releases.

### Tool gap: `bun update` is not lockfile-only on Bun 1.3.14

Every invocation form rewrites manifests: bare `bun update` pins resolved versions into `package.json` (it narrowed `peerDependencies.eslint` from `>=9.0.0` to `^10.7.0` — a breaking change to a *published* range); `-r` normalized `workspace:*` to `^0.1.0`; `bun update <pkg>@<ver>` for transitive-only packages adds them as new **root** deps while leaving the vulnerable nested copy in place. The bumps were therefore applied by direct `bun.lock` edit with version/range/`sha512` data pulled from `registry.npmjs.org`.

### Verification (re-run independently after the change)

- `rm -rf node_modules && bun install --frozen-lockfile` — **pass**, 517 packages, every hand-written `sha512` validated, lockfile not rewritten. This is exactly what `ci.yml` runs.
- Store audit: one copy per package at the intended version (both `js-yaml` branches correctly distinct); no stale vulnerable copies.
- `bun run build` / `typecheck` / `test` — **all exit 0**, 0 failures.
- `bun audit` — 1 low (esbuild only).

### Version-bump decision: no bump

The published artifacts are unaffected. Declared ranges already covered every new version (`@typescript-eslint/utils: ^8.61.1`), `tsup` externalizes `dependencies`/`peerDependencies` so nothing is bundled into `dist/`, generated `.d.ts` files *import* external types by reference rather than inlining them, and `bun.lock` is excluded from the tarball by `files`. Consumers resolve these ranges themselves at install time and already get the new versions. Republishing would ship identical tarballs under new numbers.

Local versions match npm for all 10 published packages and HEAD is tagged, so there is no unreleased source drift either.

**The bump trigger to watch:** `@noctcore/harness` 0.1.0→0.2.0 is a runtime `dependency` of `@noctcore/lint-meta-rules` at `^0.1.0`. Pre-1.0 carets don't cross minors, so that upgrade *requires* a manifest edit and is consumer-visible — it would need a `lint-meta-rules` version bump. It remains deferred.
