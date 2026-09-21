/**
 * Shared `RuleTester` for every `@noctcore` plugin's rule tests, wired to the
 * typescript-eslint parser (TS + JSX) and driven by Vitest's lifecycle hooks.
 *
 * `@typescript-eslint/rule-tester` exposes its lifecycle as assignable statics;
 * pointing them at Vitest is what lets `ruleTester.run(...)` register cases as
 * real Vitest tests. (This adapter is why the plugins use Vitest rather than
 * `bun test` for rule tests — the same choice nightcore/shiranami/shiroani made.)
 */
import { createRequire } from 'node:module';

import * as parser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

/**
 * The ESLint major the tests must run on: 10 (this package's pinned `eslint`)
 * unless the `eslint9` hook redirected it for the peer-range floor run.
 */
export const expectedEslintMajor = process.env.NOCTCORE_ESLINT_MAJOR ?? '10';

/** The ESLint version `RuleTester` actually lints with. */
export const eslintVersion = ((): string => {
  const fromHere = createRequire(import.meta.url);
  const fromRuleTester = createRequire(fromHere.resolve('@typescript-eslint/rule-tester'));
  const { version } = fromRuleTester('eslint/package.json') as { version: string };
  return version;
})();

// Fail every suite, not just one guard test, when the runtime drifts.
if (eslintVersion.split('.')[0] !== expectedEslintMajor) {
  throw new Error(
    `@noctcore/eslint-test-utils expected ESLint ${expectedEslintMajor}.x but RuleTester resolved ${eslintVersion}.`,
  );
}

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.describeSkip = describe.skip;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.itSkip = it.skip;

/** Configured `RuleTester` the rule tests run their valid/invalid cases through. */
export const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});
