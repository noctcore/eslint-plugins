<h1 align="center">@noctcore/eslint-plugins</h1>

<p align="center">
  A family of focused, general-purpose ESLint plugins that encode architecture and
  correctness conventions generic linters can't see — cross-file boundaries, IO contracts,
  and "this compiles but bites in production" patterns.
</p>

<p align="center"><em>Flat-config only · ESLint 9+ · zero-config presets · independently versioned.</em></p>

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
bun run build          # tsup — every package (ESM + CJS + d.ts)
bun run test           # vitest — every package's RuleTester suites
bun run typecheck
```

## Releasing

Changesets, two-phase: add a changeset (`bun run changeset`), merge → the bot opens a
"Version Packages" PR → merging that publishes the touched packages to npm with provenance.

## License

MIT
