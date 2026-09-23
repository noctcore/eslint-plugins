import { ruleTester } from '@noctcore/eslint-test-utils';

import { noLeakyRaceTimeoutRule } from '../../src/rules/no-leaky-race-timeout';

ruleTester.run('no-leaky-race-timeout', noLeakyRaceTimeoutRule, {
  valid: [
    // No timer in the race at all.
    { code: `async function f(a, b) { return await Promise.race([a, b]); }` },
    { code: `async function f(a) { return await Promise.race([a, new Promise((r) => emitter.once('x', r))]); }` },
    // AbortSignal.timeout has no handle to leak.
    {
      code: `async function f(url) { return await Promise.race([fetch(url), new Promise((_, rej) => AbortSignal.timeout(1000).addEventListener('abort', rej))]); }`,
    },
    { code: `async function f(url) { return await fetch(url, { signal: AbortSignal.timeout(1000) }); }` },
    // Cleared in a `.finally` chained on the race.
    {
      code: `async function f(work) {
        let timer;
        return await Promise.race([
          work,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 1000); }),
        ]).finally(() => clearTimeout(timer));
      }`,
    },
    // Cleared after `.then` in the chain.
    {
      code: `function f(work) {
        let timer;
        return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })])
          .then((v) => v)
          .finally(() => { clearTimeout(timer); });
      }`,
    },
    // Cleared in the `finally` block of an enclosing try.
    {
      code: `async function f(work: Promise<unknown>) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
        } finally {
          clearTimeout(timer);
        }
      }`,
    },
    // Cleared after the awaited race in the same function.
    {
      code: `async function f(work) {
        let timer;
        const result = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
        clearTimeout(timer);
        return result;
      }`,
    },
    // Type-asserted handle, cleared.
    {
      code: `async function f(work) {
        let timer: number;
        try {
          return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000) as unknown as number; })]);
        } finally { globalThis.clearTimeout(timer); }
      }`,
    },
    // Handle declared inside the executor and cleared inside the race.
    {
      code: `async function f(work, signal) {
        return await Promise.race([work, new Promise((_, reject) => {
          const t = setTimeout(reject, 1000);
          signal.addEventListener('abort', () => clearTimeout(t));
        })]);
      }`,
    },
    // Cleared by a cleanup callback declared before the race.
    {
      code: `async function f(work) {
        let timer;
        const stop = () => clearTimeout(timer);
        return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]).finally(stop);
      }`,
    },
    // Handle owned by an outer scope, cleared elsewhere.
    {
      code: `let timer;
      export function cancel() { clearTimeout(timer); }
      export async function f(work) {
        return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
      }`,
    },
    // `setTimeout` from node:timers/promises is not the global timer.
    {
      code: `import { setTimeout } from 'node:timers/promises';
      async function f(work, signal) {
        return await Promise.race([work, new Promise((_, reject) => { setTimeout(1000, undefined, { signal }).then(reject); })]);
      }`,
    },
    {
      code: `import { setTimeout as sleep } from 'node:timers/promises';
      async function f(work, controller) {
        try { return await Promise.race([work, sleep(1000, undefined, { signal: controller.signal })]); }
        finally { controller.abort(); }
      }`,
    },
    // Handle stored somewhere the rule cannot follow.
    {
      code: `async function f(work) {
        return await Promise.race([work, new Promise((_, reject) => { this.timer = setTimeout(reject, 1000); })]);
      }`,
    },
    {
      code: `async function f(work, timers) {
        return await Promise.race([work, new Promise((_, reject) => { timers.push(setTimeout(reject, 1000)); })]);
      }`,
    },
    // A timer inside a nested callback's return is not the executor's return.
    {
      code: `async function f(work) {
        return await Promise.race([work, new Promise((_, reject) => { ready.then(() => { return register(setTimeout(reject, 1000)); }); })]);
      }`,
    },
    // Not a Promise.race.
    { code: `async function f(work) { return await Promise.all([work, new Promise((r) => setTimeout(r, 1000))]); }` },
    { code: `function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }` },
  ],
  invalid: [
    // Handle discarded: arrow body.
    {
      code: `async function f(work) { return await Promise.race([work, new Promise((_, reject) => setTimeout(reject, 1000))]); }`,
      errors: [{ messageId: 'discardedHandle', line: 1 }],
    },
    // Handle discarded: expression statement.
    {
      code: `async function f(work) {
        return await Promise.race([work, new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), 1000); })]);
      }`,
      errors: [{ messageId: 'discardedHandle' }],
    },
    // Handle discarded: executor return, function expression form, global member form.
    {
      code: `function f(work) {
        return Promise.race([work, new Promise(function (_, reject) { return globalThis.setTimeout(reject, 1000); })]);
      }`,
      errors: [{ messageId: 'discardedHandle' }],
    },
    // Captured but never cleared.
    {
      code: `async function f(work) {
        let timer;
        return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
      }`,
      errors: [{ messageId: 'unclearedHandle', data: { name: 'timer' } }],
    },
    // Declared in the executor, never cleared.
    {
      code: `async function f(work) {
        return await Promise.race([work, new Promise((_, reject) => { const t = setTimeout(reject, 1000); })]);
      }`,
      errors: [{ messageId: 'unclearedHandle', data: { name: 't' } }],
    },
    // Cleared only before the race: the timer it clears is not this one.
    {
      code: `async function f(work) {
        let timer;
        clearTimeout(timer);
        return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
      }`,
      errors: [{ messageId: 'unclearedHandle', data: { name: 'timer' } }],
    },
    // The clear in `g` reads its own parameter, not this handle.
    {
      code: `async function f(work) {
        let timer;
        return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(reject, 1000); })]);
      }
      function g(timer) { clearTimeout(timer); }`,
      errors: [{ messageId: 'unclearedHandle', data: { name: 'timer' } }],
    },
    // Two leaking timers in one race.
    {
      code: `async function f(a) {
        return await Promise.race([
          a,
          new Promise((_, reject) => setTimeout(reject, 1000)),
          new Promise((resolve) => { setTimeout(resolve, 5000); }),
        ]);
      }`,
      errors: [{ messageId: 'discardedHandle' }, { messageId: 'discardedHandle' }],
    },
  ],
});
