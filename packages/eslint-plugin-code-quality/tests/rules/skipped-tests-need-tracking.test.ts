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
  ],
});
