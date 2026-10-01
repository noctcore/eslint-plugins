# `noctcore-code-quality/no-sleep-in-unit-tests`

> Unit tests must not sleep on the real clock.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A unit test that waits `100` ms for something to happen is guessing. On a fast machine the wait is
wasted time; on a loaded CI runner it is not long enough and the test fails for no reason. Either
way the sleep hides what the test is actually waiting for. Fake the timers and advance them, or wait
for the condition itself: the promise under test, a Testing Library `waitFor` / `findBy*`, an event.

```ts bad filename=src/hooks/use-route-announcer.test.tsx
it('announces the new route', async () => {
  navigate('/settings');
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByRole('status')).toHaveTextContent('Settings');
});
```

```ts good filename=src/hooks/use-route-announcer.test.tsx
it('announces the new route', async () => {
  navigate('/settings');
  expect(await screen.findByRole('status')).toHaveTextContent('Settings');
});
```

## What it flags

In a unit test file (a path ending in one of `testFileSuffixes`, and not containing any
`integrationMarkers`), outside the tests and suites that install fake timers:

- a `new Promise` whose executor calls `setTimeout` (or `globalThis.setTimeout`) with a callback
  that resolves it: `setTimeout(resolve, n)` or `setTimeout(() => resolve(value), n)`, in an
  expression or a block body, including a `sleep` helper written that way in the same file;
- `setTimeout` imported from `timers/promises` or `node:timers/promises`, by name, renamed or
  through a namespace import (`timers.setTimeout(n)`);
- a function made with `promisify(setTimeout)` or `util.promisify(setTimeout)`, where it is called.

```ts bad filename=tools/verify/exec.test.ts reports=3
import { setTimeout as delay } from 'node:timers/promises';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it('stops the child', async () => {
  const child = start();
  await delay(200);
  child.stop();
  const late = new Promise((resolve) => setTimeout(() => resolve('late'), 100));
  expect(await Promise.race([child.exited, late])).toBe(0);
});
```

```ts good filename=tools/verify/exec.test.ts
it('stops the child', async () => {
  vi.useFakeTimers();
  const child = start();
  await vi.advanceTimersByTimeAsync(200);
  child.stop();
  expect(await child.exited).toBe(0);
  vi.useRealTimers();
});
```

### Fake timers cover a test or a suite, not the file

A `fakeTimerMethods` call (`vi.useFakeTimers()`, `jest.useFakeTimers()`) covers the test it is
written in. Written in a suite, directly or in a `beforeEach` / `beforeAll` hook, it covers that
`describe` and the suites nested in it. Written outside any test or suite (at the top level, in a
top-level hook, or in a top-level helper such as `installClock()`), it covers the whole file. A timer
promise outside every covered test and suite runs on the real clock and is reported.

A sleep helper defined in the file (`const sleep = (ms) => new Promise(...)`, `function sleep`) is
judged by its callers. It is silent when every call to it in the file is covered, also through
another helper, and reported where it sleeps when a test on real timers calls it or nothing in the
file does.

```ts bad filename=src/lib/poller.test.ts
it('polls every second', async () => {
  vi.useFakeTimers();
  const poller = start();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(poller.ticks).toBe(1);
  vi.useRealTimers();
});

it('stops', async () => {
  const poller = start();
  poller.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(poller.ticks).toBe(0);
});
```

```ts good filename=src/lib/poller.test.ts
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('polls every second', async () => {
  const poller = start();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(poller.ticks).toBe(1);
});

it('stops', async () => {
  const poller = start();
  poller.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(poller.ticks).toBe(0);
});
```

## What it does not flag

- A zero or omitted delay while `allowZeroDelay` is on: `setTimeout(resolve, 0)` yields one
  macrotask, the idiomatic flush inside `act(...)`.
- A timer whose callback only rejects: `new Promise((_, reject) => setTimeout(() => reject(err), ms))`
  is a timeout guard for a race, not a sleep.
- A timer whose handle is kept (`timer = setTimeout(...)`, `const t = setTimeout(...)`) and passed to
  `clearTimeout` or `clearInterval` somewhere in the file: that is a deadline raced against real work,
  not a sleep, and costs wall-clock time only when the work is late. A kept handle that is never
  cleared is still reported.
- `setImmediate`, `process.nextTick` and `queueMicrotask` inside a promise.
- A `setTimeout` that is not a promise executor's resolve, such as a timer the code under test
  schedules.
- A timer promise in a test or a suite that installs fake timers with a `fakeTimerMethods` method
  (`vi.useFakeTimers()`, `jest.useFakeTimers()`), and any timer promise in a file that installs them
  at the top level or in a top-level `beforeEach`. Under fake timers the wait is virtual and the
  test drives it with `advanceTimersByTimeAsync`, so it costs no wall-clock time. A sleep helper
  defined in the file is covered when every call to it is.
- Files that are not unit tests, or whose path contains an `integrationMarkers` entry.
- A sleep helper imported from another module (`import { sleep } from './test-utils'`): the rule
  reads one file at a time, so it reports the helper where it is defined, if that file is a unit
  test, and not the calls to it.

```ts good filename=src/hooks/use-route-announcer.test.tsx
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const withTimeout = <T,>(work: Promise<T>, ms: number) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
```

```ts good filename=src/hooks/use-route-announcer.test.tsx
function trickle(chunks: string[], gapMs: number) {
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      controller.enqueue(chunks.shift());
    },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('reads a slow body', async () => {
  const body = trickle(['a'], 5_000);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await read(body)).toBe('a');
});
```

Inside a covered test or suite the check is still coarse: the order of the calls is not read, so a
sleep after `useRealTimers()` in the same test or suite stays exempt. Only helpers bound to a name
(`function sleep`, `const sleep = ...`) are followed to their callers; a sleep in an object method
or in a function passed to a wrapper is judged by where it is written. Fake timers installed from
another module or a setup file are not seen, so a timer promise that relies on them is reported.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `testFileSuffixes` | `string[]` | `.test` / `.spec` with `.ts`, `.tsx`, `.js`, `.jsx` | A file is a unit test when its path ends with one of these. |
| `integrationMarkers` | `string[]` | `.integration.test.`, `.integration.spec.`, `.e2e.test.`, `.e2e.spec.`, `.e2e-spec.`, `/integration/`, `/e2e/` | A test file whose path, relative to the ESLint working directory, contains one of these is skipped. |
| `allowZeroDelay` | `boolean` | `true` | Accept a zero or omitted delay. |
| `fakeTimerMethods` | `string[]` | `["useFakeTimers"]` | Methods (on any receiver) that install fake timers. A call covers the test it is in, else the suite it is in, else the whole file; timer promises there are not checked. |

```js
'noctcore-code-quality/no-sleep-in-unit-tests': ['error', {
  // Suites that drive real processes or a real database wait on them on purpose.
  integrationMarkers: ['.integration.', '.isolation.', '/e2e/'],
}]
```

## When not to use it

In test files that drive real child processes, servers or databases and are named like unit tests.
Name them with an integration marker, or leave the rule off for that directory.

## Related

- [`fake-timers-must-be-restored`](./fake-timers-must-be-restored.md): fake timers that leak into
  later tests.
- [`no-real-clock-in-unit-tests`](./no-real-clock-in-unit-tests.md) and
  [`no-real-network-in-unit-tests`](./no-real-network-in-unit-tests.md): the other real-world inputs a
  unit test should not depend on.
