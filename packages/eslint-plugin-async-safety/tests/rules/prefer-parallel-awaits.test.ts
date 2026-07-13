import { ruleTester } from '@noctcore/eslint-test-utils';

import { preferParallelAwaitsRule } from '../../src/rules/prefer-parallel-awaits';

ruleTester.run('prefer-parallel-awaits', preferParallelAwaitsRule, {
  valid: [
    // Data dependency: the second await consumes the first result.
    {
      code: `async function f() { const a = await getUser(); const b = await getFeed(a); return b; }`,
    },
    // Only one await — nothing to parallelize.
    { code: `async function f() { const a = await getUser(); return a; }` },
    // Mutation-looking callees are left sequential.
    { code: `async function f() { const a = await saveUser(); const b = await sendMail(); }` },
    // A nested call in the arguments — ordering may matter.
    { code: `async function f() { const a = await get(compute()); const b = await getFeed(); }` },
    // Awaiting a non-call expression.
    { code: `async function f() { const a = await x; const b = await y; }` },
    // `let` bindings are not rewritten.
    { code: `async function f() { let a = await getUser(); let b = await getFeed(); }` },
    // A statement between the awaits breaks the consecutive run.
    {
      code: `async function f() { const a = await getUser(); doStuff(); const b = await getFeed(); }`,
    },
  ],
  invalid: [
    // Two independent read calls.
    {
      code: `async function f() { const a = await getUser(); const b = await getFeed(); return { a, b }; }`,
      errors: [
        {
          messageId: 'parallelizable',
          data: { count: 2 },
          suggestions: [
            {
              messageId: 'useParallel',
              output: `async function f() { const [a, b] = await Promise.all([getUser(), getFeed()]); return { a, b }; }`,
            },
          ],
        },
      ],
    },
    // Independent member-read calls.
    {
      code: `async function f() { const u = await db.users(); const t = await db.tags(); return [u, t]; }`,
      errors: [
        {
          messageId: 'parallelizable',
          suggestions: [
            {
              messageId: 'useParallel',
              output: `async function f() { const [u, t] = await Promise.all([db.users(), db.tags()]); return [u, t]; }`,
            },
          ],
        },
      ],
    },
    // A run of three.
    {
      code: `async function f() { const a = await fa(); const b = await fb(); const c = await fc(); }`,
      errors: [
        {
          messageId: 'parallelizable',
          data: { count: 3 },
          suggestions: [
            {
              messageId: 'useParallel',
              output: `async function f() { const [a, b, c] = await Promise.all([fa(), fb(), fc()]); }`,
            },
          ],
        },
      ],
    },
    // Simple literal / identifier arguments are allowed.
    {
      code: `async function f() { const a = await get(1); const b = await find(id); return { a, b }; }`,
      errors: [
        {
          messageId: 'parallelizable',
          suggestions: [
            {
              messageId: 'useParallel',
              output: `async function f() { const [a, b] = await Promise.all([get(1), find(id)]); return { a, b }; }`,
            },
          ],
        },
      ],
    },
  ],
});
