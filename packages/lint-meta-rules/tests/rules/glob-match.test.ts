import { describe, expect, test } from 'bun:test';

import { joinRelative, literalPrefix, matchesGlob } from '../../src/rules/glob-match';

describe('matchesGlob', () => {
  const cases: [string, string, boolean][] = [
    ['src/a.test.ts', '**/*.test.ts', true],
    ['a.test.ts', '**/*.test.ts', true],
    ['src/deep/a.test.tsx', '**/*.test.ts', false],
    ['src/a.utils.test.ts', 'src/**/*.test.tsx', false],
    ['src/a.test.tsx', 'src/**/*.test.tsx', true],
    ['src/a.test.tsx', './src/**/*.test.tsx', true],
    ['src/x/y/a.test.tsx', 'src/**/*.test.tsx', true],
    ['src/x/a.spec.mts', '**/*.{test,spec}.?(c|m)[jt]s?(x)', true],
    ['src/x/a.spec.js', '**/*.{test,spec}.?(c|m)[jt]s?(x)', true],
    ['src/x/a.spec.md', '**/*.{test,spec}.?(c|m)[jt]s?(x)', false],
    ['src/__tests__/a.ts', '**/__tests__/**/*.?([mc])[jt]s?(x)', true],
    ['src/a.test.ts', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)', true],
    ['src/test.ts', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)', true],
    ['src/atest.ts', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)', false],
    ['src/routeTree.gen.ts', '**/*.gen.{ts,tsx}', true],
    ['a/generated/b/c.ts', '**/generated/**', true],
    ['src/a.ts', 'src/a.ts', true],
    ['src/a.ts', 'src', false],
  ];
  for (const [path, glob, expected] of cases) {
    test(`${path} ~ ${glob} = ${String(expected)}`, () => {
      expect(matchesGlob(path, glob)).toBe(expected);
    });
  }
});

test('literalPrefix and joinRelative', () => {
  expect(literalPrefix('src/**/*.ts')).toBe('src');
  expect(literalPrefix('./apps/web/src/*.tsx')).toBe('apps/web/src');
  expect(literalPrefix('**/*.ts')).toBe('');
  expect(literalPrefix('src/routeTree.gen.ts')).toBe('src/routeTree.gen.ts');
  expect(joinRelative('apps/web', '../api/src')).toBe('apps/api/src');
  expect(joinRelative('', './src')).toBe('src');
});
