import { ruleTester } from '@noctcore/eslint-test-utils';

import { noSleepInUnitTestsRule } from '../../src/rules/no-sleep-in-unit-tests';

const TEST_FILE = 'src/lib/download.test.ts';

ruleTester.run('no-sleep-in-unit-tests', noSleepInUnitTestsRule, {
  valid: [
    // A zero delay is the idiomatic flush inside act(...).
    {
      code: 'const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));',
      filename: 'src/features/firma/FirmaFormDialog.hooks.test.tsx',
    },
    {
      code: "it('flushes', async () => { await new Promise((resolve) => setTimeout(resolve)); });",
      filename: TEST_FILE,
    },
    // A reject-only timer is a timeout guard for a race, not a sleep.
    {
      code: "const timeout = (ms) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));",
      filename: 'packages/config/tests/wiring.test.ts',
    },
    {
      code: 'const timeout = (ms: number) => new Promise<never>((_, reject) => setTimeout(reject, ms));',
      filename: TEST_FILE,
    },
    // Settly shape: a cancellable deadline raced against real work keeps its handle.
    {
      code: `
        async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
          let timer: NodeJS.Timeout | undefined;
          try {
            return await Promise.race([
              promise,
              new Promise<typeof PENDING>((resolve) => {
                timer = setTimeout(() => resolve(PENDING), ms);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
      `,
      filename: 'tools/verify/e2e-runtime.test.ts',
    },
    {
      code: 'const deadline = new Promise((resolve) => { const t = setTimeout(resolve, waitMs); cancel = () => clearTimeout(t); });',
      filename: TEST_FILE,
    },
    // clearInterval and a global receiver count as clearing too.
    {
      code: "let t; const d = new Promise((resolve) => { t = setTimeout(resolve, 50); }); afterEach(() => globalThis.clearInterval(t));",
      filename: TEST_FILE,
    },
    // Yielding to the event loop without a delay.
    {
      code: "it('ticks', async () => { await new Promise((resolve) => setImmediate(resolve)); });",
      filename: TEST_FILE,
    },
    // A timer that is not the executor's resolve (a debounced callback under test).
    {
      code: "it('debounces', () => { setTimeout(onSave, 300); vi.advanceTimersByTime(300); expect(onSave).toHaveBeenCalled(); });",
      filename: TEST_FILE,
    },
    // A timer at the top level of the file has no enclosing function to be an executor.
    { code: 'setTimeout(onSave, 300);', filename: TEST_FILE },
    // Settly shape: a fake slow stream in a file that fakes timers, so the wait is virtual.
    {
      code: `
        function trickle(chunks: readonly string[], gapMs: number) {
          return new ReadableStream({
            async pull(controller) {
              await new Promise((resolve) => setTimeout(resolve, gapMs));
              controller.enqueue(chunks.shift());
            },
          });
        }
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });
        it('stalls', async () => {
          const body = trickle(['a'], 5_000);
          await vi.advanceTimersByTimeAsync(5_000);
          expect(await read(body)).toBe('a');
        });
      `,
      filename: 'src/lib/document-download.test.ts',
    },
    {
      code: "jest.useFakeTimers(); it('x', async () => { const p = new Promise((r) => setTimeout(r, 1000)); jest.advanceTimersByTime(1000); await p; });",
      filename: TEST_FILE,
    },
    // Fake timers installed for a suite cover its tests, nested suites included.
    {
      code: `
        describe('polling', () => {
          beforeEach(() => { vi.useFakeTimers(); });
          afterEach(() => { vi.useRealTimers(); });
          it('polls', async () => {
            const tick = new Promise((resolve) => setTimeout(resolve, 1_000));
            await vi.advanceTimersByTimeAsync(1_000);
            await tick;
          });
          describe('when offline', () => {
            it('backs off', async () => {
              const tick = new Promise((resolve) => setTimeout(resolve, 5_000));
              await vi.advanceTimersByTimeAsync(5_000);
              await tick;
            });
          });
        });
        describe('parsing', () => { it('parses', () => { expect(parse('1')).toBe(1); }); });
      `,
      filename: TEST_FILE,
    },
    // A test that installs fake timers itself covers the rest of its callback.
    {
      code: `
        it('advances', async () => {
          vi.useFakeTimers();
          const tick = new Promise((resolve) => setTimeout(resolve, 1_000));
          await vi.advanceTimersByTimeAsync(1_000);
          await tick;
          vi.useRealTimers();
        });
        it('parses', () => { expect(parse('1')).toBe(1); });
      `,
      filename: TEST_FILE,
    },
    // A top-level sleep helper that is only called where the timers are faked.
    {
      code: `
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        describe('polling', () => {
          beforeEach(() => { vi.useFakeTimers(); });
          it('polls', async () => {
            const done = sleep(1_000);
            await vi.advanceTimersByTimeAsync(1_000);
            await done;
          });
        });
        describe('parsing', () => { it('parses', () => { expect(parse('1')).toBe(1); }); });
      `,
      filename: TEST_FILE,
    },
    // A helper reached only through another helper, itself only called under fake timers.
    {
      code: `
        function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
        async function slowReply(body: string) { await sleep(2_000); return body; }
        it('times out', async () => {
          vi.useFakeTimers();
          const reply = slowReply('late');
          await vi.advanceTimersByTimeAsync(2_000);
          expect(await reply).toBe('late');
          vi.useRealTimers();
        });
        it('parses', () => { expect(parse('1')).toBe(1); });
      `,
      filename: TEST_FILE,
    },
    // A helper that calls itself, and two that call each other, are judged by their other callers.
    {
      code: `
        async function retry(times: number) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (times > 0) { await retry(times - 1); }
        }
        async function ping(n: number) { await new Promise((resolve) => setTimeout(resolve, 10)); if (n > 0) { await pong(n - 1); } }
        async function pong(n: number) { await new Promise((resolve) => setTimeout(resolve, 10)); if (n > 0) { await ping(n - 1); } }
        describe('backoff', () => {
          beforeEach(() => { jest.useFakeTimers(); });
          it('retries', async () => { const done = retry(2); await jest.advanceTimersByTimeAsync(300); await done; });
          it('rallies', async () => { const done = ping(2); await jest.advanceTimersByTimeAsync(30); await done; });
        });
        it('parses', () => { expect(parse('1')).toBe(1); });
      `,
      filename: TEST_FILE,
    },
    // `describe.each` and `it.each` are a suite and a test like any other.
    {
      code: `
        describe.each(['get', 'post'])('%s', (method) => {
          beforeAll(() => { jest.useFakeTimers(); });
          it.each([100, 200])('waits %i', async (ms) => {
            const tick = new Promise((resolve) => setTimeout(resolve, ms));
            jest.advanceTimersByTime(ms);
            await tick;
          });
        });
        describe('parsing', () => { it('parses', () => { expect(parse('1')).toBe(1); }); });
      `,
      filename: TEST_FILE,
    },
    {
      code: `
        it.each([100, 200])('waits %i', async (ms) => {
          vi.useFakeTimers();
          const tick = new Promise((resolve) => setTimeout(resolve, ms));
          vi.advanceTimersByTime(ms);
          await tick;
        });
        it('parses', () => { expect(parse('1')).toBe(1); });
      `,
      filename: TEST_FILE,
    },
    // A top-level helper that installs the timers may run before any test: the whole file is exempt.
    {
      code: `
        function installClock() { vi.useFakeTimers(); }
        it('advances', async () => {
          installClock();
          const tick = new Promise((resolve) => setTimeout(resolve, 1_000));
          await vi.advanceTimersByTimeAsync(1_000);
          await tick;
        });
        it('settles', async () => { installClock(); await new Promise((resolve) => setTimeout(resolve, 50)); });
      `,
      filename: TEST_FILE,
    },
    // Not a unit test file.
    {
      code: "it('waits', async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });",
      filename: 'src/lib/download.ts',
    },
    // Integration suites wait on real systems on purpose.
    {
      code: "it('delivers', async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });",
      filename: 'src/modules/mail/email-delivery.integration.spec.ts',
    },
    // A `setTimeout` from somewhere else is not the timers/promises sleep.
    {
      code: "import { setTimeout } from './fake-timers'; it('x', async () => { await setTimeout(100); });",
      filename: TEST_FILE,
    },
    // allowZeroDelay also covers timers/promises.
    {
      code: "import { setTimeout as tick } from 'node:timers/promises'; it('x', async () => { await tick(0); });",
      filename: TEST_FILE,
    },
  ],
  invalid: [
    // Settly shape: a fixed real sleep in a unit spec.
    {
      code: "it('reports late', async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });",
      filename: 'src/hooks/use-route-announcer.focus.test.tsx',
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '100' } }],
    },
    // Settly shape: a delay from a variable.
    {
      code: "it('spaces clicks', async () => { await new Promise((resolve) => setTimeout(resolve, gapMs)); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: 'gapMs' } }],
    },
    // Settly shape: a shared sleep helper.
    {
      code: 'const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));',
      filename: 'src/modules/auth/password-reset-request.isolation.spec.ts',
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // Settly shape: a delayed resolve with a value.
    {
      code: "const held = runner.hold(new Promise((resolve) => setTimeout(() => resolve('late'), 100)));",
      filename: 'tools/verify/interruptible.test.ts',
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // A kept handle that is never cleared is still a sleep.
    {
      code: "it('x', async () => { await new Promise((resolve) => { const t = setTimeout(resolve, 100); }); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '100' } }],
    },
    {
      code: "it('x', async () => { let t; await new Promise((resolve) => { t = setTimeout(resolve, 100); }); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // Clearing a different handle does not count.
    {
      code: "it('x', async () => { let t; let other; await new Promise((resolve) => { t = setTimeout(resolve, 100); }); clearTimeout(other); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // A block body.
    {
      code: 'it(\'x\', async () => { await new Promise((r) => { setTimeout(r, 50); }); });',
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    {
      code: "it('x', async () => { await new Promise(function (done) { globalThis.setTimeout(done, 50); }); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // timers/promises, named, renamed and namespaced.
    {
      code: "import { setTimeout } from 'node:timers/promises'; it('x', async () => { await setTimeout(200); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '200' } }],
    },
    {
      code: "import { setTimeout as sleep } from 'timers/promises'; it('x', async () => { await sleep(20); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    {
      code: "import * as timers from 'node:timers/promises'; it('x', async () => { await timers.setTimeout(20); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // A promisified setTimeout.
    {
      code: "const wait = util.promisify(setTimeout); it('x', async () => { await wait(10); });",
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // With allowZeroDelay off, the flush is reported too.
    {
      code: 'const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));',
      filename: 'src/features/firma/FirmaFormDialog.hooks.test.tsx',
      options: [{ allowZeroDelay: false }],
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '0' } }],
    },
    // A custom fake-timer method list replaces the default one.
    {
      code: "vi.useFakeTimers(); it('x', async () => { await new Promise((r) => setTimeout(r, 5)); });",
      filename: TEST_FILE,
      options: [{ fakeTimerMethods: ['installClock'] }],
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
    // One test faking its timers does not cover a sibling test that sleeps for real.
    {
      code: `
        it('advances', async () => {
          vi.useFakeTimers();
          await vi.advanceTimersByTimeAsync(100);
          vi.useRealTimers();
        });
        it('waits', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '100' }, line: 8 }],
    },
    // Fake timers installed for one suite do not cover a sibling suite.
    {
      code: `
        describe('polling', () => {
          beforeEach(() => { vi.useFakeTimers(); });
          afterEach(() => { vi.useRealTimers(); });
          it('polls', async () => { await vi.advanceTimersByTimeAsync(1_000); });
        });
        describe('upload', () => {
          it('settles', async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '50' }, line: 8 }],
    },
    // The same for a timers/promises sleep.
    {
      code: `
        import { setTimeout as delay } from 'node:timers/promises';
        it('advances', () => { jest.useFakeTimers(); jest.advanceTimersByTime(10); jest.useRealTimers(); });
        it('waits', async () => { await delay(200); });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: '200' }, line: 4 }],
    },
    // A helper called under fake timers and from a real-timer test is reported where it sleeps.
    {
      code: `
        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        describe('polling', () => {
          beforeEach(() => { vi.useFakeTimers(); });
          it('polls', async () => {
            const done = sleep(1_000);
            await vi.advanceTimersByTimeAsync(1_000);
            await done;
          });
        });
        it('retries', async () => { await sleep(100); expect(calls).toBe(2); });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: 'ms' }, line: 2 }],
    },
    // A helper nobody calls under fake timers: an unrelated test faking its clock does not cover it.
    {
      code: `
        export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        it('advances', () => { vi.useFakeTimers(); vi.advanceTimersByTime(10); vi.useRealTimers(); });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', line: 2 }],
    },
    {
      code: `
        function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
        async function slowReply(body: string) { await sleep(2_000); return body; }
        it('advances', () => { vi.useFakeTimers(); vi.advanceTimersByTime(10); vi.useRealTimers(); });
        it('replies', async () => { expect(await slowReply('late')).toBe('late'); });
      `,
      filename: TEST_FILE,
      errors: [{ messageId: 'sleepInUnitTest', data: { delay: 'ms' }, line: 2 }],
    },
    // A custom suffix brings a file into scope.
    {
      code: "it('x', async () => { await new Promise((r) => setTimeout(r, 5)); });",
      filename: 'tests/unit/queue.check.ts',
      options: [{ testFileSuffixes: ['.check.ts'] }],
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
  ],
});
