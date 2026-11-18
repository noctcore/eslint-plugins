# Vision

@noctcore/eslint-plugins is a Bun workspace of focused, general-purpose ESLint plugins (flat config, ESLint 9 and 10) that catch bugs which compile: cross-file boundaries, IO contracts and patterns that bite in production. It holds fifteen plugins, the shared `@noctcore/eslint-utils` and `@noctcore/lint-meta-rules` for whole-repo checks, each versioned and published to npm on its own.

## Goals
- Land the open owner items: #261 (lint-meta-rules to harness ^0.6), then the Version Packages PR #239 (5 minors), which only the owner merges and publishes.
- Adoption in consumer repos (Aldra, shiranami, shiroani): move to the 1.0 ranges, switch house rules to `strict`, delete local rules that the plugins now cover (lists on #140 and #142; nightcore waits).
- Keep every rule precise: a rule is either in `recommended` at `error` or deliberately omitted with a reason in `OMITTED_FROM_PRESETS`.
- Open items also include the CODE_OF_CONDUCT and links issue (#259) and npm description fixes at the next release.

## Target users
- Maintainers of TypeScript repos (NestJS, React, Electron, Prisma, TanStack Query) who want architecture and correctness rules generic linters cannot see.
- The owner's own projects, which consume these plugins first.

## Principles
- Workflow: branch from `main` and open a PR; agents never merge. The changesets "Version Packages" PR publishes to npm and always waits for the owner. Nobody bumps versions or runs `npm publish` by hand.
- Commits are `type(scope): lowercase summary` where the scope is the package's short name (`feat(security): ...`, `fix(react): ...`, `docs(site): ...`; bare `ci:` is used for CI). No AI attribution, no em or en dashes (also none in npm descriptions or rule docs).
- Package manager is Bun (`bun@1.4.2`, `bun.lock`).
- Every PR that touches a published package carries a changeset (`bun run changeset`, or `--empty` when it releases nothing).
- Every rule has a doc with at least one `bad` and one `good` example; docs are checked by the site build. Run `bun run docs:readmes` after rule changes and commit what it writes.
- No new single-rule packages and no `next` package (policy in CONTRIBUTING; `llm` and `rsc` are frozen).
- Presets use `error` or `off` only; a warning is a rule nobody obeys.

## Out of scope
- Per-project house rules that need a single repo's facts; those stay in the consumer.
- Switching consumers over in this repo; that is one adoption issue per consumer repo.
- Brand and org profile work (lives in noctcore/.github).

## Quality bar
- `bun run build`, `bun run typecheck`, `bun run test` (runs ESLint 10 and ESLint 9 legs), `bun run lint`, `bun run check:package`.
- The repo lints itself with its own rules; every schema option needs a `description`.
- The rule inventory test (`site/scripts/parity.test.ts`) holds a hand-bumped expected rule count; bump it in the same commit as a rule change.
- CI also builds the docs site on PRs touching `packages/` or `site/`.

## Protected areas
- `.github/workflows/**`
- `.changeset/config.json`
- `packages/*/package.json`
- `scripts/check-package-shape.ts`
- `scripts/sync-plugin-versions.ts`
- `LICENSE`
- `SECURITY.md`
- release
- licensing
- secrets

## Agent defaults
- Model: Sonnet for docs, notes, plans, decision records, reviews of small diffs, mechanical edits and searches; Opus only for hard code (new modules, security, cross-package changes, debugging) and say why in the brief.
- Effort: `medium` by default, `low` for docs, notes and mechanical edits, `high` only for a hard design or debugging task, with the reason in the brief.
- At most 2 agents running at once for this project; queue the rest.
- One issue or PR per agent; end the session when its PR is open or its report is in, and start a fresh agent for the next task instead of reusing a long session.
