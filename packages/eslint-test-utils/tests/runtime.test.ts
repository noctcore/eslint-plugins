/**
 * Guards what the shared `ruleTester` actually runs on. The tester's ESLint is
 * whatever `@typescript-eslint/rule-tester` resolves, so a drifted pin or a
 * broken `eslint9` hook would otherwise go on testing a runtime nobody chose.
 */
import { describe, expect, it } from 'vitest';

import { eslintVersion, expectedEslintMajor, ruleTester } from '../src';

type Rule = Parameters<typeof ruleTester.run>[1];

/**
 * Reports what `Program.parent` is. `@typescript-eslint/types` declares it
 * `parent?: never`, so a `!== undefined` ancestor walk type-checks, but every
 * ESLint in the peer range sets it to `null` at runtime and the walk then
 * dereferences `null`. Rule tests only catch that if the tester keeps `null`.
 */
const programParentRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { parent: 'Program.parent is {{parent}}' },
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(node): void {
        const parent: unknown = Reflect.get(node, 'parent');
        context.report({
          node,
          messageId: 'parent',
          data: { parent: parent === null ? 'null' : typeof parent },
        });
      },
    };
  },
} satisfies Rule;

describe('ruleTester runtime', () => {
  it(`runs ESLint ${expectedEslintMajor}`, () => {
    expect(eslintVersion.split('.')[0]).toBe(expectedEslintMajor);
  });
});

ruleTester.run('program-parent', programParentRule, {
  valid: [],
  invalid: [
    {
      code: 'const answer = 42;',
      errors: [
        {
          messageId: 'parent',
          data: { parent: 'null' },
        },
      ],
    },
  ],
});
