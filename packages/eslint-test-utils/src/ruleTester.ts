/**
 * Shared `RuleTester` for every `@noctcore` plugin's rule tests, wired to the
 * typescript-eslint parser (TS + JSX) and driven by Vitest's lifecycle hooks.
 *
 * `@typescript-eslint/rule-tester` exposes its lifecycle as assignable statics;
 * pointing them at Vitest is what lets `ruleTester.run(...)` register cases as
 * real Vitest tests. (This adapter is why the plugins use Vitest rather than
 * `bun test` for rule tests — the same choice nightcore/shiranami/shiroani made.)
 */
import * as parser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

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
