# `eslint-rules-not-weakened`

> Every pinned ESLint rule holds at least its pinned severity and options in the RESOLVED config, so a
> spread preset or a later override cannot weaken it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createEslintRulesNotWeakenedRule` from `@noctcore/lint-meta-rules/resolved-config` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `resolved-config` entry point, which (unlike the main one) loads ESLint:

```ts
import { createEslintRulesNotWeakenedRule } from '@noctcore/lint-meta-rules/resolved-config';
```

## Why

A contract such as "no `as` casts" or "no floating promises" is only real while the ESLint rule behind
it stays on at the strength you chose. `@typescript-eslint/consistent-type-assertions` with
`assertionStyle: 'as'` still allows casts; only `'never'` forbids them. A config can lose that pin
without any line the project owns saying so: a preset spread after your block sets the rule to
`{ assertionStyle: 'as' }`, or an override block further down turns it `off`. A text scan of the config
file sees neither.

This rule asks ESLint itself. It resolves each package's effective flat config with
`calculateConfigForFile` and compares every rule in `pinned` against what ESLint will actually run.

## What it flags

For every directory matched by `packages` that holds one of `configFiles`, it resolves the config for
each of `probes` (glob matching only, so the probe files need not exist) and reports, once per package,
probe and pinned rule, a pinned rule that:

- is **absent** from the resolved config;
- is **off**;
- resolves **below** its pinned severity (a rule pinned to `'error'` that resolves to `'warn'`);
- carries a **different value** for an option key the pin lists. Only the listed keys are compared,
  deeply, against the first option object of the resolved entry; keys the pin does not list are free.

Each violation names the package directory, the probe and the rule, and lands on the package's config
file.

It **fails closed** like [`eslint-config-no-warn`](./eslint-config-no-warn.md): a config that cannot be
loaded, a probe whose resolution throws, or a config that ignores every probe is a violation, since no
pinned rule could be checked.

Async: it implements the harness's `runAsync` (`@noctcore/harness` 0.3.0 or newer).

## What it does not flag

- Anything at all while `pinned` is unset or empty: the rule is inert and resolves nothing.
- A probe matched by `exemptProbes`, which is how a deliberate relaxation (tests allowed to cast) is
  declared.
- A rule that resolves stronger than its pin (`'error'` for a pin of `'warn'`).
- A probe the config merely ignores, while another probe resolves.
- **Blocks scoped to a file shape no probe matches.** A test override that turns a pinned rule off is
  only seen when a probe matches that block: the default probes cover `.ts`, `.tsx`, `.test.ts` and
  `.test.tsx` under `src/`, so a block for `e2e/**` or `*.spec.ts` stays invisible until you add a probe
  for that shape.

## Options

```ts
createEslintRulesNotWeakenedRule(options?: EslintRulesNotWeakenedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'eslint-rules-not-weakened'` | Rule id, for running more than one instance. |
| `pinned` | `Record<string, PinnedRule>` | `{}` | Rule id to the minimum it must hold: a severity (`'error'`, `'warn'`, `2`, `1`) or a severity plus the option keys that must match (`['error', { assertionStyle: 'never' }]`). |
| `exemptProbes` | `string[]` | `[]` | Globs over the probe paths whose resolved config may relax pinned rules on purpose; those probes are not checked. |
| `packages` | `string[]` | `['.', 'apps/*', 'packages/*']` | Directories whose config is resolved: globs, or `.` for the root. A match is checked only when it holds one of `configFiles`. |
| `configFiles` | `string[]` | `['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']` | File names that mark a directory as owning a flat config. The first one present names the violation's file. |
| `probes` | `string[]` | `src/__lint_meta_probe__.{ts,tsx,test.ts,test.tsx}` | Files, relative to each package, the config is resolved for. Add one per file shape your config scopes blocks to. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

`packages`, `configFiles` and `probes` share their defaults with
[`eslint-config-no-warn`](./eslint-config-no-warn.md).

### Example

Pin the cast ban and the floating-promise check, and let test files cast:

```ts
createEslintRulesNotWeakenedRule({
  pinned: {
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    '@typescript-eslint/no-floating-promises': 'error',
  },
  exemptProbes: ['**/*.test.ts', '**/*.test.tsx'],
});
```

A config with `'@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }]`
passes. The same rule set to `{ assertionStyle: 'as' }` by a spread preset, or `'off'` in an override
block that a non-exempt probe matches, is reported.

### Notes

- The comparison is over the options the config sets, as ESLint resolves them; a rule's own built-in
  defaults are not filled in, so pin only keys your config sets.
- Only the first option object of a rule entry is compared. A rule whose options live in a later slot
  can still be pinned by severity.
- It is not in `RULE_FACTORIES` or `createAllRules()`: register it yourself from the `resolved-config`
  entry.
- If a config imports a workspace package that must be built first, build it before lint-meta, or the
  rule reports that the config could not be resolved.

## When not to use it

If your repo has no flat ESLint config per package, or you cannot build the workspace packages a config
imports before lint-meta runs, this rule cannot resolve anything. If nothing in your config is a
contract worth pinning, leave it out: it does nothing without `pinned`.

## Related

- [`eslint-config-no-warn`](./eslint-config-no-warn.md): the same resolution, checking that no rule
  resolves to `warn`.
- [`no-warn-severity`](./no-warn-severity.md): the instant text scan for `warn` literals.
