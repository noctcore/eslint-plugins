<h1 align="center">@noctcore/eslint-plugins</h1>

<p align="center">
  A family of focused, general-purpose ESLint plugins that encode architecture and
  correctness conventions generic linters can't see: cross-file boundaries, IO contracts,
  and "this compiles but bites in production" patterns.
</p>

<p align="center">
  <a href="https://github.com/noctcore/eslint-plugins/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/noctcore/eslint-plugins/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/noctcore/eslint-plugins/actions/workflows/docs.yml"><img alt="Docs" src="https://github.com/noctcore/eslint-plugins/actions/workflows/docs.yml/badge.svg?branch=main"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center"><em>Flat-config only · ESLint 9+ · zero-config presets · independently versioned.</em></p>

<p align="center"><strong><a href="https://noctcore.github.io/eslint-plugins/">Documentation: noctcore.github.io/eslint-plugins</a></strong><br/>
What each plugin is for, when it is a bad fit, and every rule with its options and examples.</p>

---

## Packages

Eleven ESLint plugins, plus `@noctcore/lint-meta-rules` for whole-repo checks and
`@noctcore/eslint-utils`, the shared building block they are made with. Each plugin is versioned
and installed on its own.

| Package | npm | What it enforces |
| --- | --- | --- |
| [`@noctcore/eslint-plugin-code-quality`](./packages/eslint-plugin-code-quality) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-code-quality?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-code-quality) | Guard clauses, comment and test hygiene, deterministic time, no stray `process.exit` |
| [`@noctcore/eslint-plugin-async-safety`](./packages/eslint-plugin-async-safety) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-async-safety?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-async-safety) | Fetch timeouts, `AbortSignal` forwarding, async races and shared mutable state |
| [`@noctcore/eslint-plugin-contracts`](./packages/eslint-plugin-contracts) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-contracts?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-contracts) | IO boundaries (checked fetch, parsed boundary data), error cause and taxonomy, zod schema and wire naming, env access, decimal money, translation keys |
| [`@noctcore/eslint-plugin-security`](./packages/eslint-plugin-security) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-security?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-security) | Shell injection, path traversal, SSRF, open redirect, unsanitized HTML (XSS), timing-unsafe comparison, server actions that bypass their action client |
| [`@noctcore/eslint-plugin-observability`](./packages/eslint-plugin-observability) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-observability?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-observability) | Structured logging: context objects over interpolation, no sensitive fields in logs, no lost error detail, declared PII in audit payloads |
| [`@noctcore/eslint-plugin-react`](./packages/eslint-plugin-react) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-react?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-react) | React architecture and correctness (prop drilling, state colocation, memoized context, effect safety, guarded web storage) |
| [`@noctcore/eslint-plugin-rsc`](./packages/eslint-plugin-rsc) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-rsc?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-rsc) | React Server Components / App Router correctness (navigation errors that must not be swallowed) |
| [`@noctcore/eslint-plugin-llm`](./packages/eslint-plugin-llm) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-llm?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-llm) | LLM output treated as untrusted input before it reaches a sink |
| [`@noctcore/eslint-plugin-prisma`](./packages/eslint-plugin-prisma) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-prisma?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-prisma) | Prisma tenancy, soft-delete and transaction guardrails (tenant-scope escape hatches, raw SQL, request-body writes, single-writer models, audit placement) |
| [`@noctcore/eslint-plugin-architecture`](./packages/eslint-plugin-architecture) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-architecture?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-architecture) | Module and folder shape (folder-per-component, barrels, feature boundaries, import depth, colocated tests) |
| [`@noctcore/eslint-plugin-monorepo`](./packages/eslint-plugin-monorepo) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-plugin-monorepo?label=)](https://www.npmjs.com/package/@noctcore/eslint-plugin-monorepo) | Workspace package boundaries (barrel-only and exports-map-aware imports); needs your workspace scope |
| [`@noctcore/eslint-utils`](./packages/eslint-utils) | [![npm](https://img.shields.io/npm/v/@noctcore/eslint-utils?label=)](https://www.npmjs.com/package/@noctcore/eslint-utils) | Shared rule-creator + AST helpers (internal building block) |
| [`@noctcore/lint-meta-rules`](./packages/lint-meta-rules) | [![npm](https://img.shields.io/npm/v/@noctcore/lint-meta-rules?label=)](https://www.npmjs.com/package/@noctcore/lint-meta-rules) | Whole-repo structure-lock rules for [`@noctcore/harness`](https://www.npmjs.com/package/@noctcore/harness) |

## Install

Requirements: ESLint 9 or newer, flat config (`eslint.config.js`) only. Install the plugins you want
and `@typescript-eslint/parser`:

```sh
npm i -D @noctcore/eslint-plugin-code-quality @typescript-eslint/parser   # or bun add -D / pnpm add -D
```

Every plugin's `configs.recommended` registers the plugin and sets rule severities, nothing else. It
sets no `files` and no parser, so on its own ESLint cannot read TypeScript. Give it both:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import codeQuality from '@noctcore/eslint-plugin-code-quality';

export default [
  {
    ...codeQuality.configs.recommended,
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
  },
];
```

If your config already sets the parser for those files (through `typescript-eslint`'s configs, for
example), spreading the preset alongside it is enough.

## Where to start

Start with the three plugins that fit almost any TypeScript codebase, then add the ones for the
stack you use:

| Add | When |
| --- | --- |
| `code-quality`, `async-safety`, `contracts` | Always: the starter set |
| `security` | You run server code (shell, HTTP, redirects, HTML rendering) |
| `react` | You write React components |
| `rsc` | You use the Next.js App Router / React Server Components |
| `prisma` | You use Prisma (several rules need your tenant models; see its README) |
| `llm` | You call an LLM SDK |
| `observability` | You log through a structured logger |
| `architecture`, `monorepo` | You want folder and package boundaries enforced (`monorepo` needs your scope) |

One config that spreads several presets. Each preset is its own entry with the same `files` and
parser; they do not merge, and the plugin namespaces (`noctcore-<plugin>`) never collide:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser';
import asyncSafety from '@noctcore/eslint-plugin-async-safety';
import codeQuality from '@noctcore/eslint-plugin-code-quality';
import contracts from '@noctcore/eslint-plugin-contracts';
import react from '@noctcore/eslint-plugin-react';
import security from '@noctcore/eslint-plugin-security';

const typescript = { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tsParser } };

export default [
  // The starter set.
  { ...codeQuality.configs.recommended, ...typescript },
  { ...asyncSafety.configs.recommended, ...typescript },
  { ...contracts.configs.recommended, ...typescript },
  // Add the ones for your stack.
  { ...security.configs.recommended, ...typescript },
  { ...react.configs.recommended, ...typescript },
];
```

Every preset rule is `error`, never `warn`. In a codebase that already has hundreds of hits, read
[adopting in an existing codebase](https://noctcore.github.io/eslint-plugins/adopting/) first: it
shows how to switch the flooding rules off and turn them back on one directory at a time. Rules
that need a per-project fact (a scope, a model list, an action-client name) are opt-in; each
package README lists them under "Opt-in rules", with the config that turns them on.

## Reporting a problem

A rule that reports correct code, or misses code it documents as bad, is the report that matters
most for plugins that run at `error`. The [issue forms](https://github.com/noctcore/eslint-plugins/issues/new/choose)
ask for the rule id, the code, the options and the versions, which is what makes one actionable.
There is a form for rule proposals too; it asks what the rule must **not** flag, because that is the
question that decides whether it can ship.

## Develop

```sh
bun install
bun run build       # first, always: typecheck resolves @noctcore/eslint-utils through its built d.ts
bun run typecheck
bun run test        # every package, on ESLint 10 and then on ESLint 9
bun run docs:dev    # the docs site (site/), at http://localhost:4321/eslint-plugins/
```

[CONTRIBUTING.md](./CONTRIBUTING.md) has the rest: where a rule lives, the severity policy, the
executable rule docs, the generated README tables, and what a changeset means here. Read it before
adding a rule.

## Releasing

Changesets, two-phase: add a changeset (`bun run changeset`), merge, the bot opens a "Version
Packages" PR, and merging that publishes the touched packages to npm with provenance.

## License

MIT
