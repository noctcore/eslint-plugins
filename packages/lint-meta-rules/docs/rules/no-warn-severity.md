# `no-warn-severity`

> ESLint severity is `error` or `off`, never `warn`.

## Why

Agents iterate by reading CI failures. A `warn` severity is a silent miss — it neither fails the
build nor gets acted on — so a rule that matters must be an `error`, and a rule that does not should
be `off`. There is no useful middle.

## What it flags

Reads each configured flat-config file (skipping any that do not exist), strips line comments, and
reports any line containing a `'warn'` / `"warn"` severity literal. The violation carries the
1-indexed line number.

## Factory

```ts
createNoWarnSeverityRule(options?: NoWarnSeverityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configFiles` | `string[]` | `['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']` | Flat-config files to scan; each is read only if present. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded `eslint.config.mjs`.

## When not to use it

If your project deliberately uses `warn` as an in-editor nudge that is not meant to gate CI, this rule
does not fit — though the recommended pattern is a separate lint layer for gating and `off` for
everything else.
