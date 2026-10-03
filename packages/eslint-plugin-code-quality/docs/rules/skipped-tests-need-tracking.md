# `noctcore-code-quality/skipped-tests-need-tracking`

> A skipped test must carry a tracking marker (issue URL or `TODO(@owner)`) so the debt has an owner.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`.skip` / `.fixme` / `xit` / `xdescribe` are escape hatches. Left unowned they rot into permanent dark
zones — nobody remembers why the test is off or who is meant to turn it back on. Requiring a tracking
marker (an issue URL or a `TODO(@owner)`) within a few lines of the skip keeps a human attached to the
debt.

`.only` is deliberately **not** covered here — [`no-focused-tests`](./no-focused-tests.md) bans it
outright, so it can never legitimately appear with or without tracking.

## What it flags

Any call of a skip form (`it.skip(` / `test.skip(` / `describe.skip(`, the `.fixme(` variants,
`xit(`, `xdescribe(`, `xtest(`) with **no** tracking marker on that line or within the `lookback`
window above it. The report sits on the callee (`it.skip`, `xit`).

The skip is read from the syntax, the marker from the source text: the lines of the lookback window
are scanned as written, so a marker in a trailing comment, a preceding comment, or anywhere in the
window is honoured.

```ts bad filename=src/example.test.ts reports=2
// untracked
it.skip('later', () => {});
xdescribe('later', () => {});
```

```ts good filename=src/example.test.ts
// tracked
// TODO(@alice): flaky under CI
it.skip('later', () => {});

it.skip('later', () => {}); // https://github.com/org/repo/issues/1
```

### `node:test` skips

`node:test` skips through the test's options or its context, the same way it spells a platform
guard. Only an unconditional skip is reported, on the option or the call:

- a `skip` or `todo` option on `test` / `it` / `describe` / `suite` (and a `t.test` subtest) whose
  value is a truthy literal: `{ skip: true }`, `{ skip: 1 }`, `{ todo: 'write it' }`;
- `t.skip()` / `t.todo()` (or `await t.skip()`) as a statement of the test callback's own body,
  where `t` is the callback's context parameter.

```ts bad filename=scripts/release.test.ts reports=2
test('publishes the tarball', { skip: 'broken on the new registry' }, async () => {});

test('signs the release', (t) => {
  t.todo('needs the new key');
});
```

```ts good filename=scripts/release.test.ts
// TODO(@alice): the new registry rejects the tarball
test('publishes the tarball', { skip: 'broken on the new registry' }, async () => {});

test('signs the release', (t) => {
  t.todo('needs the new key, https://github.com/org/repo/issues/12');
});
```

## What it does not flag

- A test that is not skipped.
- A skip with a `markers` match on its own line or within the `lookback` lines above it.
- `.only`: [`no-focused-tests`](./no-focused-tests.md) bans it outright.
- A conditional `node:test` skip: an option whose value is computed
  (`{ skip: process.platform === 'win32' }`, `{ skip: !ready }`, shorthand `{ skip }`), or a
  `t.skip(...)` inside an `if`, a loop or a helper. Those are platform or environment guards.
- A `skip` / `todo` key in an object passed to anything that is not a test runner, and a `skip`
  method on a receiver that is not the test's context (`query.skip(10)`).
- The text of a skip that is not a call: inside a string, a template literal or a comment. A test
  that lints probe code held as a string can spell a skipped test in its own source.

```ts good filename=scripts/release.test.ts
test('uses POSIX signals', { skip: process.platform === 'win32' }, () => {});

test('kills the process group', (t) => {
  if (process.platform === 'win32') {
    t.skip('taskkill ends a Windows tree at once');
    return;
  }
});
```

```ts good filename=src/example.test.ts
// A probe for the linter, e.g. it.skip('later', () => {}), is not a skipped test.
const probe = "it.skip('later', () => {});";

it('reports an untracked skip', async () => {
  expect(await lint(probe)).toHaveLength(1);
});
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
