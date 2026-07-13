# `noctcore-code-quality/skipped-tests-need-tracking`

> A skipped test must carry a tracking marker (issue URL or `TODO(@owner)`) so the debt has an owner.

## Why

`.skip` / `.fixme` / `xit` / `xdescribe` are escape hatches. Left unowned they rot into permanent dark
zones — nobody remembers why the test is off or who is meant to turn it back on. Requiring a tracking
marker (an issue URL or a `TODO(@owner)`) within a few lines of the skip keeps a human attached to the
debt.

`.only` is deliberately **not** covered here — [`no-focused-tests`](./no-focused-tests.md) bans it
outright, so it can never legitimately appear with or without tracking.

## What it flags

Any line matching a skip form — `it.skip(` / `test.skip(` / `describe.skip(`, the `.fixme(` variants,
`xit(`, `xdescribe(`, `xtest(` — with **no** tracking marker on that line or within the `lookback`
window above it.

Faithful to the original text-scanning implementation, the source is scanned line by line, so a marker
in a trailing comment, a preceding comment, or anywhere in the lookback window is honoured.

```ts
// ✓ tracked
// TODO(@alice): flaky under CI
it.skip('later', () => {});

it.skip('later', () => {}); // https://github.com/org/repo/issues/1

// ✗ untracked
it.skip('later', () => {});
xdescribe('later', () => {});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `markers` | `string[]` (regex sources) | `["https?://\\S+", "TODO\\(@?\\S+\\)"]` | Any pattern that, if found in the lookback window, satisfies the tracking requirement. Compiled with the `u` flag. |
| `lookback` | `integer` (≥0) | `30` | How many lines above the skip a marker may live and still count. |

```js
// Require a Jira-style key instead of a URL / TODO.
'noctcore-code-quality/skipped-tests-need-tracking': ['error', { markers: ['[A-Z]+-\\d+'] }]
```

## When not to use it

If your project already enforces skip-tracking another way, or never skips tests.
