# `noctcore-code-quality/fake-timers-must-be-restored`

> A file that installs fake timers must restore real ones.

Ported from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Why

`jest.useFakeTimers()` / `vi.useFakeTimers()` replace the global clock. Without a matching
`useRealTimers()` the fake clock leaks into later tests in the same worker, and those tests fail or,
worse, pass for the wrong reason, depending on file order.

## What it flags

Every call to a `fakeTimerMethods` method (`useFakeTimers` by default, as `name()` or `obj.name()`)
in a file with no call to a `restoreTimerMethods` method, unless the restore lives in a shared suite
the file runs.

### Shared suites

A contract suite often owns the restore: the spec installs fake timers inside a helper it hands to
the suite, and the suite restores them in its own `afterEach`.

```ts
// provider.contract-suite.ts
export function runProviderContract(subject: Subject): void {
  describe('provider contract', () => {
    afterEach(() => jest.useRealTimers());
    // ...
  });
}

// fake-provider.contract.spec.ts
import { runProviderContract } from './provider.contract-suite';

const advancePastDeadline = () => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.now() + 86_400_000);
};

runProviderContract({ advancePastDeadline });
```

With `followImportedSuites` on (the default), the rule follows each relative import whose binding the
file calls (`runProviderContract(...)` or `suite.run(...)`), resolves it on disk (`.ts`, `.tsx`,
`.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, or a directory `index`), and accepts a restore call
in that module's source. The check is one level deep and text-based. An import that is only
re-exported, never called, does not count.

For a suite the rule cannot resolve (a path alias or a workspace package), name it in
`sharedSuiteModules`.

```ts
// Bad
beforeEach(() => {
  vi.useFakeTimers();
});

it('expires the session', () => {
  vi.advanceTimersByTime(60_000);
  expect(session.isExpired()).toBe(true);
});
```

```ts
// Good
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('expires the session', () => {
  vi.advanceTimersByTime(60_000);
  expect(session.isExpired()).toBe(true);
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fakeTimerMethods` | `string[]` | `["useFakeTimers"]` | Methods that install fake timers. |
| `restoreTimerMethods` | `string[]` | `["useRealTimers"]` | Methods that restore real timers. One call anywhere in the file satisfies the rule. |
| `followImportedSuites` | `boolean` | `true` | Accept a restore found in a relative module this file imports and calls. |
| `sharedSuiteModules` | `string[]` (globs) | `[]` | Import specifiers trusted to restore timers when the file imports and calls them. Supports `*`, `**`, `?` and `{a,b}`. |

```js
'noctcore-code-quality/fake-timers-must-be-restored': ['error', {
  fakeTimerMethods: ['useFakeTimers', 'install'],
  restoreTimerMethods: ['useRealTimers', 'uninstall'],
  sharedSuiteModules: ['@acme/testing/*-suite'],
}]
```

## Caveats

Reading an imported suite from disk means an edit to the suite alone does not invalidate
`eslint --cache` for the spec. The rule caches each suite's source by modification time within one
process.

## When not to use it

If your runner restores timers globally (for example a setup file with a global `afterEach` that
calls `useRealTimers()`).
