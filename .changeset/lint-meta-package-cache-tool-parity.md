---
'@noctcore/lint-meta-rules': minor
---

Two new opt-in factories, both listed in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` builds neither and projects see no new violations until they name them in `optIn` or call the factory:

- `createGithubActionsPackageCacheRule` (`github-actions-package-cache`): a job that installs with npm, pnpm or yarn must set the matching `cache:` on one of its `actions/setup-node` steps (inputs read as a block or a one-line flow mapping; npm with a `packageManager` field relies on the automatic cache of setup-node v6 and later), and a job that runs `bun install` must have an `actions/cache` step (the Bun setup action caches only the bun binary). Options `managers`, `setupActions`, `cacheActions`, `workflowGlobs`, `ciCritical`.
- `createSharedToolVersionParityRule` (`shared-tool-version-parity`): workspace packages that declare the same dev tool (default `eslint`, `typescript`, `prettier`, `typescript-eslint`, `@eslint/js`, plus any `toolPrefixes`) must declare the same version, compared as written; a tool declared by one package is never reported, and `workspace:` and `catalog:` specifiers are skipped. Options `tools`, `toolPrefixes`, `workspaces` (default the root `workspaces` or `pnpm-workspace.yaml`), `includeRoot`, `fields`, `ciCritical`.

The shared YAML comment stripper used by every workflow rule is now a linear scan, and it now also strips a trailing comment on a CRLF line (the old pattern left `cache: pnpm # note\r` whole), so workflow rules read values in CRLF workflows the same as in LF ones.
