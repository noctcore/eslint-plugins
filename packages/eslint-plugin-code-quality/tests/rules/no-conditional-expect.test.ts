import { ruleTester } from '@noctcore/eslint-test-utils';

import { noConditionalExpectRule } from '../../src/rules/no-conditional-expect';

ruleTester.run('no-conditional-expect', noConditionalExpectRule, {
  valid: [
    { code: "it('adds', () => { expect(add(1, 2)).toBe(3); });" },
    // Top-level expect: the ancestor walk climbs past Program, whose parent is
    // null at runtime although the types say undefined.
    { code: 'expect(setup()).toBe(true);' },
    // A suite-level loop that generates tests: every expect runs in its own test.
    {
      code: `
        describe('cases', () => {
          for (const c of cases) {
            it(c.name, () => { expect(parse(c.input)).toEqual(c.output); });
          }
        });
      `,
    },
    {
      code: `
        if (process.env.SLOW) {
          test('slow path', () => { expect(run()).toBe(1); });
        }
      `,
    },
    // The expect is the condition, not the branch body.
    { code: "it('x', () => { if (expect(a).toBe(1)) { log(); } });" },
    { code: "it('x', () => { expect(a ?? b).toBe(1); });" },
    // An assertion-count guard makes a skipped branch fail the test.
    {
      code: `
        it('rejects', async () => {
          expect.assertions(1);
          try { await load(); } catch (error) { expect(error).toBeInstanceOf(LoadError); }
        });
      `,
    },
    {
      code: "it('x', () => { expect.hasAssertions(); if (a) { expect(a).toBe(1); } });",
    },
    // Supertest's `.expect(200)` chain is not a test assertion call.
    { code: "it('x', async () => { if (auth) { await request(app).get('/').expect(200); } });" },
    // Loops are not conditional by default: table-driven loops are idiomatic.
    { code: "it('all', () => { for (const row of rows) { expect(row.id).toBeGreaterThan(0); } });" },
    { code: "it('x', () => { for (const p of ['B', 'C']) { if (p) { log(p); } expect(f(p)).toBe(1); } });" },
  ],
  invalid: [
    {
      code: "it('x', () => { if (result.ok) { expect(result.value).toBe(1); } });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: "it('x', () => { flag ? expect(a).toBe(1) : noop(); });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: "it('x', () => { ready && expect(a).toBe(1); });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: "it('x', () => { switch (kind) { case 'a': expect(a).toBe(1); break; } });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: `
        it('rejects', async () => {
          try { await load(); } catch (error) { expect(error).toBeInstanceOf(LoadError); }
        });
      `,
      errors: [{ messageId: 'conditionalExpect' }],
    },
    // Configured: loops count as conditional (the loop may run zero times).
    {
      code: "it('all', () => { for (const row of rows) { expect(row.id).toBeGreaterThan(0); } });",
      options: [{ checkLoops: true }],
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: "it('x', () => { while (next()) { expect(cur).toBeTruthy(); } });",
      options: [{ checkLoops: true }],
      errors: [{ messageId: 'conditionalExpect' }],
    },
    // A branch inside a loop is conditional either way.
    {
      code: "it('x', () => { for (const o of outcomes) { if (o.failed) { expect(o.reason).toBe('x'); } } });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    // A callback inside a branch is still conditional.
    {
      code: "it('x', () => { if (items) { items.forEach((i) => expect(i).toBe(1)); } });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
    // A guard in a different test does not cover this one.
    {
      code: `
        it('a', () => { expect.assertions(1); expect(1 + 1).toBe(2); });
        it('b', () => { if (x) { expect(x).toBe(1); } });
      `,
      errors: [{ messageId: 'conditionalExpect' }],
    },
    {
      code: "it('x', () => { if (a) { t.expect(a).toBe(1); } });",
      errors: [{ messageId: 'conditionalExpect' }],
    },
  ],
});
