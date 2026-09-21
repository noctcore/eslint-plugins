import { ruleTester } from '@noctcore/eslint-test-utils';

import { noVacuousExpectRule } from '../../src/rules/no-vacuous-expect';

ruleTester.run('no-vacuous-expect', noVacuousExpectRule, {
  valid: [
    { code: "it('adds', () => { expect(add(1, 2)).toBe(3); });" },
    // A weak matcher is fine next to a real assertion.
    {
      code: `
        it('creates', () => {
          const user = create();
          expect(user).toBeDefined();
          expect(user.name).toBe('ada');
        });
      `,
    },
    // `toBeUndefined` pins a specific absence, so it is not weak by default.
    { code: "it('clears', () => { cache.clear(); expect(cache.get('k')).toBeUndefined(); });" },
    // A weak expect paired with a non-expect assertion.
    {
      code: `
        it('responds', async () => {
          expect(app).toBeTruthy();
          await request(app).get('/health').expect(200);
        });
      `,
    },
    { code: "test('asserts', () => { expect(result).toBeDefined(); assert.equal(result.id, 1); });" },
    { code: "test('helper', () => { expect(user).toBeTruthy(); expectValidUser(user); });" },
    // Negated tautology always fails; it is broken, not vacuous.
    { code: "it('x', () => { expect(1).not.toBe(1); });" },
    // `not.toBeNull` on a DOM query pins presence; not weak by default.
    { code: "it('renders', () => { expect(container.querySelector('nav')).not.toBeNull(); });" },
    // Outside a test callback the sole-weak check does not apply.
    { code: 'const check = () => expect(value).toBeDefined();' },
    // Configured: only `toBeDefined` is weak.
    {
      code: "it('truthy', () => { expect(isReady()).toBeTruthy(); });",
      options: [{ weakMatchers: ['toBeDefined'] }],
    },
  ],
  invalid: [
    {
      code: "it('exists', () => { expect(service).toBeDefined(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeDefined' } }],
    },
    {
      code: "test('ok', async () => { expect(await load()).toBeTruthy(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeTruthy' } }],
    },
    {
      code: "it('present', () => { expect(value).not.toBeUndefined(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'not.toBeUndefined' } }],
    },
    // Runner modifiers and `each` tables are still tests.
    {
      code: "it.concurrent('exists', () => { expect(x).toBeDefined(); });",
      errors: [{ messageId: 'soleWeakExpect' }],
    },
    {
      code: "test.each([1, 2])('case %i', (n) => { expect(f(n)).toBeTruthy(); });",
      errors: [{ messageId: 'soleWeakExpect' }],
    },
    {
      code: "it('fn', () => { expect(typeof handler).toBe('function'); });",
      errors: [{ messageId: 'typeofExpect' }],
    },
    {
      code: "it('fn', () => { expect(typeof handler).not.toEqual('undefined'); expect(handler()).toBe(1); });",
      errors: [{ messageId: 'typeofExpect' }],
    },
    {
      code: "it('true', () => { expect(true).toBe(true); });",
      errors: [{ messageId: 'tautologyExpect' }],
    },
    {
      code: "it('lit', () => { expect('a').toStrictEqual('a'); expect(run()).toBe(2); });",
      errors: [{ messageId: 'tautologyExpect' }],
    },
    // Configured: `toBeUndefined` added back as weak.
    {
      code: "it('gone', () => { expect(cache.get('k')).toBeUndefined(); });",
      options: [{ weakMatchers: ['toBeUndefined'] }],
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeUndefined' } }],
    },
    // Configured: no extra assertion callees, so `assert.ok` no longer rescues the test.
    {
      code: "it('x', () => { expect(x).toBeDefined(); assert.ok(x.id); });",
      options: [{ assertionCallees: [] }],
      errors: [{ messageId: 'soleWeakExpect' }],
    },
  ],
});
