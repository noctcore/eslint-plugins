# `noctcore-code-quality/no-real-clock-in-unit-tests`

> A unit test that reads the real clock must fake it; an offset from now is allowed.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A fixture built from `new Date()` is a different fixture on every run. The test passes at noon and
fails at midnight, on the last day of the month, across a DST change or on a runner in another time
zone, and nobody can reproduce the failure the next morning. An exact-now value compared with a
value the code computed a moment later is also a race.

Fake the clock for the file (`vi.useFakeTimers()` plus `vi.setSystemTime(...)`, or Jest's
equivalent), mock the project's clock module, or write the date down.

```ts bad filename=src/auth/token.service.spec.ts
it('expires a token issued now', () => {
  const token = issue({ issuedAt: new Date() });
  expect(isExpired(token)).toBe(false);
});
```

```ts good filename=src/auth/token.service.spec.ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it('expires a token issued now', () => {
  const token = issue({ issuedAt: new Date() });
  expect(isExpired(token)).toBe(false);
});
```

## What it flags

In a unit test file (a path ending in one of `testFileSuffixes`, and not containing any
`integrationMarkers`) that never fakes the clock:

- `Date.now()`;
- an argless `new Date()`, and `Date()` called as a function;

unless the value is an offset from now (below).

```ts bad filename=src/auth/session.service.spec.ts reports=3
const started = Date.now();
const row = { deletedAt: new Date(), stamp: new Date().toISOString() };
```

```ts good filename=src/auth/session.service.spec.ts
const started = new Date('2026-01-15T10:00:00Z').getTime();
const row = { deletedAt: new Date('2026-01-15T10:00:00Z'), stamp: '2026-01-15T10:00:00.000Z' };
```

### Offsets from now are allowed

A value that only needs to be "later than now" or "earlier than now" is robust against the real
clock, because the code under test reads the same clock: a token that expires in a minute is still
valid when the assertion runs. So a `Date.now()` that is a direct operand of `+` or `-`
(`Date.now() + 60_000`, `Date.now() - 2 * MINUTE`) is not reported, and neither is an argless
`new Date()` turned into a number that is offset (`new Date().getTime() + 1000`, `+new Date() - 1000`).

```ts good filename=src/auth/session.service.spec.ts
const lockedUntil = new Date(Date.now() + 60_000);
const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
```

A comparison (`Date.now() < deadline`) or an exact-now fixture is not an offset and is reported, and
so is a date built from now and then mutated (`d.setDate(d.getDate() + 1)`): write it as an offset.

### What fakes the clock

The rule reads the whole file. Any one of these, anywhere in it, turns the rule off for that file:

- a call to a `fakeClockMethods` method (`vi.useFakeTimers()`, `jest.setSystemTime(...)`);
- a spy or stub that replaces `Date.now` or the global `Date` (`jest.spyOn(Date, 'now')`,
  `vi.spyOn(globalThis, 'Date')`, `jest.replaceProperty(global, 'Date', ...)`,
  `vi.stubGlobal('Date', ...)`), or an assignment to `Date.now`;
- a module mock (`jest.mock`, `vi.mock`, `doMock`, `unstable_mockModule`) of a module matching
  `clockModules`.

## What it does not flag

- `new Date(value)` with an argument, and `Date.parse(...)`.
- A clock faked through a library call the rule does not know, such as `MockDate.set(...)`: the rule
  reports that file. Add the method to `fakeClockMethods` only if its name is specific enough (a
  method name matches on any receiver, so `set` would also match `map.set`), or mock the module
  that reads the clock and list it in `clockModules`.
- `performance.now()`: it measures a duration, not a date. A test that asserts on elapsed time has a
  different problem (a timing assertion) that this rule does not judge.
- Files that are not unit tests, or whose path contains an `integrationMarkers` entry.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `testFileSuffixes` | `string[]` | `.test` / `.spec` with `.ts`, `.tsx`, `.js`, `.jsx` | A file is a unit test when its path ends with one of these. |
| `integrationMarkers` | `string[]` | `.integration.test.`, `.integration.spec.`, `.e2e.test.`, `.e2e.spec.`, `.e2e-spec.`, `/integration/`, `/e2e/` | A test file whose path, relative to the ESLint working directory, contains one of these is skipped. |
| `fakeClockMethods` | `string[]` | `["useFakeTimers", "setSystemTime"]` | Methods that fake the clock for the file, on any receiver. |
| `clockModules` | `string[]` (globs) | `[]` | Module specifiers whose mock controls the clock, matched against the specifier as written (`**/common/clock` matches `'../../common/clock'`). |

```js
'noctcore-code-quality/no-real-clock-in-unit-tests': ['error', {
  clockModules: ['**/common/clock', '@acme/shared/clock'],
}]
```

```ts good filename=src/auth/token.service.spec.ts reconfigured options={"clockModules":["**/common/clock"]}
jest.mock('../../common/clock', () => ({ nowMs: () => 1_700_000_000_000 }));

it('expires a token issued now', () => {
  const token = issue({ issuedAt: new Date() });
  expect(isExpired(token)).toBe(false);
});
```

## When not to use it

In a suite that tests against a real database whose own timestamps are the real clock; name it with
an integration marker instead of turning the rule off everywhere.

## Related

- [`no-bare-date-now`](./no-bare-date-now.md): the same clock seam in application code.
- [`fake-timers-must-be-restored`](./fake-timers-must-be-restored.md): the fake clock has to be
  restored for the next test.
- [`no-sleep-in-unit-tests`](./no-sleep-in-unit-tests.md) and
  [`no-real-network-in-unit-tests`](./no-real-network-in-unit-tests.md): the other real-world inputs a
  unit test should not depend on.
