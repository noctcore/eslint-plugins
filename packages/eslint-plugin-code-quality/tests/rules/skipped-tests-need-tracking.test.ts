import { ruleTester } from '@noctcore/eslint-test-utils';

import { skippedTestsNeedTrackingRule } from '../../src/rules/skipped-tests-need-tracking';

ruleTester.run('skipped-tests-need-tracking', skippedTestsNeedTrackingRule, {
  valid: [
    // A normal (non-skipped) test needs no marker.
    { code: "it('runs', () => {});" },
    // Skip tracked by an issue URL in a trailing comment on the same line.
    {
      code: "it.skip('later', () => {}); // https://github.com/noctcore/eslint-plugins/issues/1",
    },
    // Skip tracked by a TODO(@owner) on the line above.
    {
      code: "// TODO(@alice): flaky under CI\nit.skip('later', () => {});",
    },
    // xit tracked by a URL above.
    {
      code: "// see https://example.com/issue/9\nxit('later', () => {});",
    },
    // A custom marker format satisfied by an issue key.
    {
      code: "it.skip('later', () => {}); // ISSUE-42",
      options: [{ markers: ['ISSUE-\\d+'] }],
    },
    // node:test: a platform guard is not debt.
    { code: "describe('sandbox:inspect --refresh exit codes', { skip: process.platform === 'win32' }, () => {});" },
    { code: "it('blocks with decision:block', { skip: !ready }, () => {});" },
    { code: "test('needs docker', { skip }, () => {});" },
    { code: "test('runs', { skip: false, todo: '' }, () => {});" },
    { code: "test('runs', { skip: 0, todo: null }, () => {});" },
    {
      code: "test('guarded', async (t) => {\n  if (!posix) {\n    await t.skip('POSIX only');\n    return;\n  }\n});",
    },
    {
      code: `
        it('waits for the rest of the group', async (t) => {
          if (!posix) {
            t.skip('POSIX process groups; taskkill /t /f ends a Windows tree at once');
            return;
          }
          await run();
        });
      `,
    },
    {
      code: `
        for (const signal of ['SIGINT', 'SIGTERM']) {
          it(\`dies of \${signal}\`, async (t) => {
            if (process.platform === 'win32' && signal !== 'SIGINT') {
              t.skip('Windows delivers no catchable SIGTERM');
              return;
            }
          });
        }
      `,
    },
    // node:test: an unconditional skip with a tracking marker.
    { code: "test('later', { skip: 'https://github.com/noctcore/eslint-plugins/issues/1' }, () => {});" },
    { code: "// TODO(@alice): flaky on the runner\ntest('later', { todo: true }, () => {});" },
    { code: "test('later', async (t) => {\n  // https://example.com/issue/9\n  t.skip();\n});" },
    // An options object passed to something that is not a runner (a report fixture).
    { code: "const report = pass(FILE_A, 'later', 0, { skip: true });" },
    // `skip` on a non-context receiver (a query builder) is not a test skip.
    { code: "it('pages', (t) => { const q = query.skip(10); assert.equal(q.offset, 10); });" },
  ],
  invalid: [
    {
      code: "it.skip('later', () => {});",
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    {
      code: "xdescribe('later', () => {});",
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    {
      code: "test.fixme('later', () => {});",
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    // A marker outside the lookback window does not count.
    {
      code: "// https://example.com/issue/9\n\n\nit.skip('later', () => {});",
      options: [{ lookback: 1 }],
      errors: [{ messageId: 'needsTracking', line: 4 }],
    },
    // Under a custom marker format, a bare URL no longer satisfies the rule.
    {
      code: "it.skip('later', () => {}); // https://example.com/issue/9",
      options: [{ markers: ['ISSUE-\\d+'] }],
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    // node:test options: unconditional skip and todo.
    {
      code: "test('later', { skip: true }, () => {});",
      errors: [{ messageId: 'needsTracking', line: 1, data: { label: '{ skip }' } }],
    },
    {
      code: "describe('someday', { todo: 'write it' }, () => {});",
      errors: [{ messageId: 'needsTracking', line: 1, data: { label: '{ todo }' } }],
    },
    {
      code: "test({ 'skip': `not yet` }, () => {});",
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    // A subtest through the context.
    {
      code: "test('outer', async (t) => {\n  await t.test('inner', { skip: true }, () => {});\n});",
      errors: [{ messageId: 'needsTracking', line: 2 }],
    },
    // node:test context: an unconditional t.skip() / t.todo().
    {
      code: "test('later', (t) => {\n  t.skip('not ready');\n  run();\n});",
      errors: [{ messageId: 'needsTracking', line: 2, data: { label: 't.skip(' } }],
    },
    {
      code: "it('later', function (ctx) { ctx.todo(); });",
      errors: [{ messageId: 'needsTracking', line: 1, data: { label: 'ctx.todo(' } }],
    },
    {
      code: "test('later', (t) => t.skip());",
      errors: [{ messageId: 'needsTracking', line: 1 }],
    },
    // An awaited context skip, and any truthy literal option value.
    {
      code: "test('later', async (t) => {\n  await t.skip('not ready');\n});",
      errors: [{ messageId: 'needsTracking', line: 2, data: { label: 't.skip(' } }],
    },
    {
      code: "test('later', { skip: 1 }, () => {});",
      errors: [{ messageId: 'needsTracking', line: 1, data: { label: '{ skip }' } }],
    },
  ],
});
