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
    // A custom suffix brings a file into scope.
    {
      code: "it('x', async () => { await new Promise((r) => setTimeout(r, 5)); });",
      filename: 'tests/unit/queue.check.ts',
      options: [{ testFileSuffixes: ['.check.ts'] }],
      errors: [{ messageId: 'sleepInUnitTest' }],
    },
  ],
});
