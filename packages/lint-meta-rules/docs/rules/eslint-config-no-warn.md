# `eslint-config-no-warn`

> Every rule in the RESOLVED ESLint config is `error` or `off`, never `warn`, including severities a
> spread preset injects.

Import it from the `resolved-config` entry point, which (unlike the main one) loads ESLint:

```ts
import { createEslintConfigNoWarnRule } from '@noctcore/lint-meta-rules/resolved-config';
```

## Why

A `warn` neither fails CI nor gets fixed. [`no-warn-severity`](./no-warn-severity.md) scans config
TEXT for a `'warn'` literal, which misses the common case: a preset spread into the config
(`...reactHooks.configs['recommended-latest']`) ships rules at `warn`, and no file the project owns
spells the word. This rule asks ESLint itself. It resolves each package's effective flat config with
`calculateConfigForFile` and reports every rule that ends up at severity 1, however it got there.

Use both: the text scan is instant and runs anywhere; this one is the one a preset cannot slip past.

## What it flags

For every directory matched by `packages` that holds one of `configFiles`, it resolves the config for
each of `probes` (glob matching only, so the probe files need not exist) and reports, once per rule
id, every rule whose resolved severity is `warn` (`1`, `'warn'`, or `['warn', ...]`).

It **fails closed**:

- a config that cannot be loaded (a missing import, an unbuilt workspace package) is a violation;
- a probe whose resolution THROWS is a violation even when another probe resolves, so a config that
  breaks for one file shape cannot pass on the shapes that still work;
- a package whose config ignores every probe is a violation, since nothing was checked.

A probe that is merely ignored is fine while another probe resolves.

Async: it implements the harness's `runAsync` (`@noctcore/harness` 0.3.0 or newer).

## Factory

```ts
createEslintConfigNoWarnRule(options?: EslintConfigNoWarnOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'eslint-config-no-warn'` | Rule id, for running more than one instance. |
| `packages` | `string[]` | `['.', 'apps/*', 'packages/*']` | Directories whose config is resolved: globs, or `.` for the root. A match is checked only when it holds one of `configFiles`. |
| `configFiles` | `string[]` | `['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']` | File names that mark a directory as owning a flat config. The first one present names the violation's file. |
| `probes` | `string[]` | `src/__lint_meta_probe__.{ts,tsx,test.ts,test.tsx}` | Files, relative to each package, the config is resolved for. Add one per file shape your config scopes blocks to (`.js`, `.vue`, `e2e/**`). |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Worked example: a pnpm monorepo

A layout where every app and package owns a config built from a shared `@repo/eslint-config`, and the
root config only lints tooling:

```ts
createEslintConfigNoWarnRule({ packages: ['apps/*', 'packages/*'] });
```

Deleting the three `react-hooks/*` overrides from the shared React config (so the
`recommended-latest` preset's `warn` shows through, with no `warn` literal anywhere) reports three
rules in each of the three packages that spread it.

## Notes

- The rule resolves with the `eslint` that `@noctcore/lint-meta-rules` resolves, which is the
  consumer's own install when it is hoisted.
- If a config imports a workspace package that must be built first, build it before lint-meta, or
  the rule reports that the config could not be resolved.
