import { ruleTester } from '@noctcore/eslint-test-utils';

import { noSwallowedAssertionRule } from '../../src/rules/no-swallowed-assertion';

const swallowed = { messageId: 'swallowedInCatch' as const };
const promiseSwallowed = { messageId: 'swallowedInPromiseCatch' as const };

ruleTester.run('no-swallowed-assertion', noSwallowedAssertionRule, {
  valid: [
    // The catch rethrows.
    {
      code: `
        it('loads', async () => {
          try { expect(await load()).toBe(1); } catch (error) { cleanup(); throw error; }
        });
      `,
    },
    // The catch rethrows only unexpected errors.
    {
      code: `
        it('loads', async () => {
          try { expect(await load()).toBe(1); } catch (error) {
            if (!(error instanceof NetworkError)) throw error;
          }
        });
      `,
    },
    // The catch asserts (that is no-conditional-expect's business, not this rule's).
    {
      code: `
        it('rejects', async () => {
          try { await parse(''); expect.unreachable(); } catch (error) { expect(error).toBeInstanceOf(ParseError); }
        });
      `,
    },
    // The catch fails the test explicitly.
    {
      code: "it('x', () => { try { expect(run()).toBe(1); } catch { fail('run threw'); } });",
    },
    {
      code: "test('x', (t) => { try { t.assert(run()); } catch { t.fail(); } });",
    },
    // The caught error is handed on or kept.
    {
      code: "it('x', (done) => { try { expect(run()).toBe(1); done(); } catch (error) { done(error); } });",
    },
    // A retry loop that fails the test after the last attempt.
    {
      code: `
        it('eventually settles', async () => {
          let lastError;
          for (let attempt = 0; attempt < 5; attempt++) {
            try { expect(await status()).toBe('ready'); return; } catch (error) { lastError = error; }
          }
          throw lastError;
        });
      `,
    },
    {
      code: `
        it('eventually settles', async () => {
          let ready = false;
          for (let attempt = 0; attempt < 5 && !ready; attempt++) {
            try { expect(await status()).toBe('ready'); ready = true; } catch { await sleep(100); }
          }
          expect(ready).toBe(true);
        });
      `,
    },
    // try/finally without a catch does not swallow.
    {
      code: "it('x', () => { try { expect(run()).toBe(1); } finally { reset(); } });",
    },
    // The expect lives in the catch, not the try.
    {
      code: "it('x', async () => { try { await run(); } catch (error) { expect(error).toMatchObject({ code: 1 }); } });",
    },
    // No assertion in the try.
    {
      code: "it('x', () => { try { setup(); } catch {} expect(run()).toBe(1); });",
    },
    // Outside a test or hook callback: production code with node:assert.
    {
      code: 'function check(value) { try { assert(value > 0); } catch { return false; } return true; }',
    },
    // Supertest's .expect hangs off a call and is not an assertion here.
    {
      code: "it('x', async () => { try { await request(app).get('/').expect(200); } catch (error) { report(error); } });",
    },
    // The try/catch is inside a nested it, and the catch rethrows.
    {
      code: "describe('s', () => { try { it('x', () => { expect(1).toBe(1); }); } catch {} });",
    },
    // A promise .catch that asserts, rethrows or is not on an expect chain.
    {
      code: "it('x', async () => { await expect(load()).rejects.toThrow().catch((error) => { throw error; }); });",
    },
    {
      code: "it('x', async () => { await load().catch(() => {}); expect(state).toBe('idle'); });",
    },
    {
      code: "it('x', async () => { await expect(load()).resolves.toBe(1).catch((error) => report(error)); });",
    },
    // A synchronous chain is not a promise.
    {
      code: "it('x', () => { const p = expect(value).toBe(1); });",
    },
  ],
  invalid: [
    {
      code: "it('loads', async () => { try { expect(await load()).toBe(1); } catch {} });",
      errors: [swallowed],
    },
    {
      code: `
        it('loads', async () => {
          try {
            const result = await load();
            expect(result.items).toHaveLength(3);
          } catch (error) {
            console.warn('flaky, ignoring', error.message);
          }
        });
      `,
      errors: [swallowed],
    },
    {
      code: "test('x', () => { try { assert.equal(run(), 1); } catch (error) { console.log(error); } });",
      errors: [swallowed],
    },
    {
      code: "it('x', () => { try { expect(run()).toBe(1); } catch (error) { return; } });",
      errors: [swallowed],
    },
    // Nested in a helper callback inside the test: the error still propagates to the catch.
    {
      code: "it('x', async () => { try { await waitFor(() => expect(screen.getByText('Hi')).toBeVisible()); } catch {} });",
      errors: [swallowed],
    },
    // One report per try, even with several assertions.
    {
      code: "it('x', () => { try { expect(a).toBe(1); expect(b).toBe(2); } catch (_) {} });",
      errors: [swallowed],
    },
    // Hooks count, and so do each/concurrent variants.
    {
      code: "beforeEach(() => { try { expect(db.ready).toBe(true); } catch {} });",
      errors: [swallowed],
    },
    {
      code: "it.each(cases)('%s', (c) => { try { expect(parse(c)).toBeTruthy(); } catch {} });",
      errors: [swallowed],
    },
    // A retry loop with nothing after it: the last failure is swallowed too.
    {
      code: `
        it('eventually settles', async () => {
          for (let attempt = 0; attempt < 5; attempt++) {
            try { expect(await status()).toBe('ready'); break; } catch { await sleep(100); }
          }
        });
      `,
      errors: [swallowed],
    },
    {
      code: "it('x', async () => { await expect(load()).rejects.toThrow('boom').catch(() => {}); });",
      errors: [promiseSwallowed],
    },
    {
      code: "it('x', async () => { await expect(load()).resolves.toEqual({ ok: true }).catch((error) => console.error(error)); });",
      errors: [promiseSwallowed],
    },
    {
      code: "it('x', () => expect(load()).resolves.not.toBeNull().catch(function () { return null; }));",
      errors: [promiseSwallowed],
    },
  ],
});
