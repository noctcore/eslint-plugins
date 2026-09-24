# `no-warn-severity`

> ESLint severity is `error` or `off`, never `warn`.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createNoWarnSeverityRule` from `@noctcore/lint-meta-rules` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

Agents iterate by reading CI failures. A `warn` severity is a silent miss — it neither fails the
build nor gets acted on — so a rule that matters must be an `error`, and a rule that does not should
be `off`. There is no useful middle.

## What it flags

Reads each configured flat-config file (skipping any that do not exist), strips line comments, and
reports any line containing a `'warn'` / `"warn"` severity literal. The violation carries the
1-indexed line number.

## What it does not flag

- A `'warn'` inside a `//` line comment.
- The numeric severity `1`: only the quoted `'warn'` / `"warn"` literal is matched.
- A `warn` a spread preset injects, since no file the project owns spells it. Use
  [`eslint-config-no-warn`](./eslint-config-no-warn.md) for the resolved config.
- Config files not listed in `configFiles` (the defaults are the root flat configs), and listed ones that
  do not exist.

## Options

```ts
createNoWarnSeverityRule(options?: NoWarnSeverityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configFiles` | `string[]` | `['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']` | Flat-config files to scan; each is read only if present. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your project deliberately uses `warn` as an in-editor nudge that is not meant to gate CI, this rule
does not fit — though the recommended pattern is a separate lint layer for gating and `off` for
everything else.
