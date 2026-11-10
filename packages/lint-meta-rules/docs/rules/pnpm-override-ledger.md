# `pnpm-override-ledger`

> Every pnpm override has a dated ledger entry saying why it exists, and the lockfile honours it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createPnpmOverrideLedgerRule` from `@noctcore/lint-meta-rules` · Category `supply-chain` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A pnpm override is a security control written as a bare version string. It carries no advisory, no
first patched version and no expiry, and from the outside a stale override looks exactly like a live
one. Real failures this catches: an override that pinned into the vulnerable range (the advisory
was `<=7.5.20` and the pin was `7.5.20`), so it fired on every install and landed on a vulnerable
version; new advisories that widened past pins that were right when written; overrides one patch
behind the fix, actively holding the tree on vulnerable versions.

A ledger file keyed by the exact override key carries the missing facts:

```json
{
  "tar@<7.5.21": {
    "kind": "security",
    "advisories": ["GHSA-r292-9mhp-454m"],
    "firstPatched": "7.5.21",
    "reason": "The advisory range is <=7.5.20.",
    "reviewBy": "2026-12-01"
  }
}
```

`kind` is `security` or `unify` (a selector-less pin that collapses the tree onto one copy).

## What it flags

Overrides are read from the root `package.json` `pnpm.overrides` and from the `overrides:` mapping
in `pnpm-workspace.yaml`. The rule reports:

1. an override with no ledger entry, a ledger entry with no override, and overrides with no ledger
   file at all;
2. an entry without a non-empty `reason`, or whose `reviewBy` is missing, not a real `yyyy-MM-dd`
   date, or past. An entry is green for the whole of its `reviewBy` day by the UTC calendar, so every
   machine agrees, and red from the next;
3. a `security` entry with no `firstPatched`, or whose target can only resolve below it;
4. a lockfile that still resolves a version inside the override's selector (declared, not honoured);
5. a selector-less pin the lockfile resolves to more than one version, and a lockfile `overrides:`
   block that disagrees with what is declared (the install was not rerun).

## What it does not flag

- A repo with no overrides and no ledger.
- A version string it cannot parse in the lockfile: skipped rather than guessed at. A selector it
  cannot read (`<x`, `<=x`, `>=a <b`, `=x` are read) is reported instead, so it cannot pass silently.

The lockfile is read as text from its `packages:` section; `snapshots:` repeats the same keys with
peer suffixes and is skipped.

## Options

```ts
createPnpmOverrideLedgerRule(options?: PnpmOverrideLedgerOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ledgerFile` | `string` | `'overrides.ledger.json'` | The ledger, a JSON object keyed by the exact override key. |
| `lockfile` | `string` | `'pnpm-lock.yaml'` | The lockfile read for resolved versions. |
| `now` | `() => Date` | the current date | Today, for the `reviewBy` check; pass a fixed date in tests. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

A past `reviewBy` turns the whole `lint-meta` gate red until the entry is renewed with a reason or
the override is removed. That is the point: an automated feed that should have noticed a stale
override (Dependabot security updates, for one) can pause on its own.

## When not to use it

If you have no pnpm overrides, it stays silent; if you use npm or Bun `overrides`, it does not read
them.
