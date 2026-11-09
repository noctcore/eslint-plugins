import { ruleTester } from '@noctcore/eslint-test-utils';

import { noFocusedTestsRule } from '../../src/rules/no-focused-tests';

ruleTester.run('no-focused-tests', noFocusedTestsRule, {
  valid: [
    { code: "it('runs', () => {});" },
    { code: "describe('suite', () => {});" },
    { code: "test('case', () => {});" },
    // A plain variable named `only` is not a focused test.
    { code: 'const only = true;' },
    // `.only` on something that is not a test runner is out of scope.
    { code: "queue.only('ignored');" },
    // A chained modifier whose root is not a runner is out of scope.
    { code: "db.batch.only('ignored');" },
    // A method named `fit` on some object is not the focused-test global.
    { code: "layout.fit('contain');" },
    // Reading it.only as a value focuses nothing (the RuleTester wiring).
    { code: 'RuleTester.itOnly = it.only;' },
    { code: 'const focus = describe.only;' },
  ],
  invalid: [
    // A chain that is called still focuses.
    {
      code: "it.only.each([1, 2])('case %i', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "it.each([1, 2])('case %i', () => {});" }] }],
    },
    {
      code: 'test.only.each`a | b`("case", () => {});',
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: 'test.each`a | b`("case", () => {});' }] }],
    },
    {
      code: "it.only('runs', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "it('runs', () => {});" }] }],
    },
    {
      code: "describe.only('suite', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "describe('suite', () => {});" }] }],
    },
    {
      code: "test.only('case', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "test('case', () => {});" }] }],
    },
    // Chained modifiers (vitest concurrent) still resolve to the root runner.
    {
      code: "test.concurrent.only('case', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "test.concurrent('case', () => {});" }] }],
    },
    {
      code: "describe.concurrent.only('suite', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "describe.concurrent('suite', () => {});" }] }],
    },
    {
      code: "it.concurrent.only('runs', () => {});",
      errors: [{ messageId: 'focused', suggestions: [{ messageId: 'removeOnly', output: "it.concurrent('runs', () => {});" }] }],
    },
    {
      code: "fit('runs', () => {});",
      errors: [{ messageId: 'focusedCall', suggestions: [{ messageId: 'useBase', output: "it('runs', () => {});" }] }],
    },
    {
      code: "fdescribe('suite', () => {});",
      errors: [{ messageId: 'focusedCall', suggestions: [{ messageId: 'useBase', output: "describe('suite', () => {});" }] }],
    },
    {
      code: "ddescribe('suite', () => {});",
      errors: [{ messageId: 'focusedCall', suggestions: [{ messageId: 'useBase', output: "describe('suite', () => {});" }] }],
    },
  ],
});
