import { ruleTester } from '@noctcore/eslint-test-utils';

import { noConcurrentSharedMutationRule } from '../../src/rules/no-concurrent-shared-mutation';

ruleTester.run('no-concurrent-shared-mutation', noConcurrentSharedMutationRule, {
  valid: [
    // `arr.push` is order-tolerant, not a lost update.
    {
      code: `async function f(items) { const arr = []; await Promise.all(items.map(async (x) => { arr.push(await g(x)); })); }`,
    },
    // Distinct-index write.
    {
      code: `async function f(items) { const results = []; await Promise.all(items.map(async (x, i) => { results[i] = await g(x); })); }`,
    },
    // Accumulator local to the callback.
    {
      code: `async function f(items) { await Promise.all(items.map(async (x) => { let local = 0; local += await g(x); })); }`,
    },
    // Non-async callback — runs to completion per iteration.
    {
      code: `async function f(items) { let count = 0; await Promise.all(items.map((x) => { count++; return x; })); }`,
    },
    // Async callback but no await — no interleaving point.
    {
      code: `async function f(items) { let count = 0; await Promise.all(items.map(async (x) => { count++; })); }`,
    },
    // Not wrapped in Promise.all — outside the concurrent shape we key on.
    {
      code: `async function f(items) { let total = 0; items.map(async (x) => { total += await g(x); }); }`,
    },
    // Plain overwrite (last-write-wins), not a read-modify-write.
    {
      code: `async function f(items) { let last; await Promise.all(items.map(async (x) => { last = await g(x); })); }`,
    },
  ],
  invalid: [
    // Compound assignment across an await.
    {
      code: `async function f(items) { let total = 0; await Promise.all(items.map(async (x) => { total += await g(x); })); return total; }`,
      errors: [{ messageId: 'concurrentMutation', data: { name: 'total' } }],
    },
    // Self-referential plain assignment.
    {
      code: `async function f(items) { let total = 0; await Promise.all(items.map(async (x) => { total = total + await g(x); })); }`,
      errors: [{ messageId: 'concurrentMutation', data: { name: 'total' } }],
    },
    // Update expression after an await.
    {
      code: `async function f(items) { let count = 0; await Promise.all(items.map(async (x) => { await g(x); count++; })); }`,
      errors: [{ messageId: 'concurrentMutation', data: { name: 'count' } }],
    },
    // allSettled counts as concurrent too.
    {
      code: `async function f(items) { let n = 0; await Promise.allSettled(items.map(async (x) => { n += await g(x); })); }`,
      errors: [{ messageId: 'concurrentMutation', data: { name: 'n' } }],
    },
  ],
});
