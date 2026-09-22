<h1 align="center">@noctcore/eslint-plugins</h1>

<p align="center">
  A family of focused, general-purpose ESLint plugins that encode architecture and
  correctness conventions generic linters can't see — cross-file boundaries, IO contracts,
  and "this compiles but bites in production" patterns.
</p>

<p align="center"><em>Flat-config only · ESLint 9+ · zero-config presets · independently versioned.</em></p>

<p align="center"><strong><a href="https://noctcore.github.io/eslint-plugins/">Documentation: noctcore.github.io/eslint-plugins</a></strong><br/>
What each plugin is for, when it is a bad fit, and every rule with its options and examples.</p>

---

## Packages

| Package | What it enforces |
| --- | --- |
| [`@noctcore/eslint-plugin-react`](./packages/eslint-plugin-react) | React architecture + correctness (prop-drilling, state colocation, memoized context, effect safety) |
| [`@noctcore/eslint-plugin-architecture`](./packages/eslint-plugin-architecture) | Module/folder shape (folder-per-component, barrels, feature boundaries) |
| [`@noctcore/eslint-plugin-monorepo`](./packages/eslint-plugin-monorepo) | Workspace + package-boundary hygiene |
| [`@noctcore/eslint-plugin-contracts`](./packages/eslint-plugin-contracts) | IO boundaries, error taxonomy, schema + wire naming |
| [`@noctcore/eslint-plugin-code-quality`](./packages/eslint-plugin-code-quality) | Guard clauses, comment/test hygiene, deterministic time |
| [`@noctcore/eslint-plugin-async-safety`](./packages/eslint-plugin-async-safety) | await/abort/fetch + async races |
| [`@noctcore/eslint-plugin-observability`](./packages/eslint-plugin-observability) | Structured logging discipline |
| [`@noctcore/eslint-plugin-security`](./packages/eslint-plugin-security) | Injection / path-traversal precision |
| [`@noctcore/eslint-utils`](./packages/eslint-utils) | Shared rule-creator + AST helpers (internal building block) |
| [`@noctcore/lint-meta-rules`](./packages/lint-meta-rules) | Whole-repo structure-lock rules for [`@noctcore/harness`](https://www.npmjs.com/package/@noctcore/harness) |

## Install

```sh
bun add -D @noctcore/eslint-plugin-react   # or npm i -D / pnpm add -D
```

```js
// eslint.config.js (flat config)
import react from '@noctcore/eslint-plugin-react';

export default [react.configs.recommended];
```

## Develop

```sh
bun install
bun run build          # tsup — every package (ESM + CJS + d.ts). Run this before typecheck.
bun run typecheck      # resolves @noctcore/eslint-utils through its built d.ts, so build first
bun run test           # vitest — every package's suites, on ESLint 10 and then on ESLint 9
bun run docs:dev       # the docs site (site/), live at http://localhost:4321/eslint-plugins/
bun run docs:build     # build it and check routes, base paths and every rule's docs URL
```

[CONTRIBUTING.md](./CONTRIBUTING.md) has the rule-contribution path: where a rule lives, the
severity policy (`error` or `off`, never `warn`), the executable rule docs, the hand-pinned
rule/doc parity count, and what a changeset means here. Read it before adding a rule; the gotchas
are real.

The docs site in [`site/`](./site) is generated: each rule page is built from that rule's
`packages/*/docs/rules/<rule>.md`, and each package's rule table from the plugin's exported rule
metadata. Edit the doc in the package, never a file under `site/src/content/docs/rules/`. A test in
`site/scripts/parity.test.ts` fails if a rule has no doc or a doc has no rule. The site deploys to
GitHub Pages from `main` through `.github/workflows/docs.yml`.

## Releasing

Changesets, two-phase: add a changeset (`bun run changeset`), merge → the bot opens a
"Version Packages" PR → merging that publishes the touched packages to npm with provenance.

## Reporting a problem

A rule that reports correct code, or misses code it documents as bad, is the report that matters
most for plugins that run at `error`. The [issue forms](https://github.com/noctcore/eslint-plugins/issues/new/choose)
ask for the rule id, the code, the options and the versions, which is what makes one actionable.
There is a form for rule proposals too; it asks what the rule must **not** flag, because that is the
question that decides whether it can ship.

## License

MIT
