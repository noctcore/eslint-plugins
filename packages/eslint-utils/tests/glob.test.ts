import { describe, expect, it } from 'vitest';

import { globToRegExp, matchesAnyGlob, toPosixPath } from '../src/glob';

describe('globToRegExp', () => {
  it.each([
    // `**/` matches zero or more leading directories.
    ['**/prisma/seed.ts', 'prisma/seed.ts', true],
    ['**/prisma/seed.ts', '/repo/apps/api/prisma/seed.ts', true],
    ['**/tests/**', '/repo/packages/a/tests/unit/x.test.ts', true],
    ['**/tests/**', '/repo/packages/a/src/x.ts', false],
    // A bare `**` crosses separators; `*` and `?` stay within one segment.
    ['src/**.ts', 'src/a/b.ts', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['src/?.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
    // Literal alternatives, as every plugin accepted.
    ['**/*.{test,spec}.ts', '/repo/a.test.ts', true],
    ['**/*.{test,spec}.ts', '/repo/a.spec.ts', true],
    ['**/*.{test,spec}.ts', '/repo/a.ts', false],
    // Wildcards and nested braces inside alternatives.
    ['{src/**,lib/*}.ts', 'src/a/b.ts', true],
    ['{src/**,lib/*}.ts', 'lib/a.ts', true],
    ['{src/**,lib/*}.ts', 'lib/a/b.ts', false],
    ['**/{a,{b,c}}.ts', '/x/c.ts', true],
    // Unmatched braces and commas outside braces are literal characters.
    ['src/{a.ts', 'src/{a.ts', true],
    ['src/a}.ts', 'src/a}.ts', true],
    ['a,b.ts', 'a,b.ts', true],
    // Regex metacharacters are literal.
    ['src/(a)+[b].ts', 'src/(a)+[b].ts', true],
    ['src/a.ts', 'src/aXts', false],
    // Dotfiles match: no implicit dot exclusion.
    ['**/*.ts', '/repo/.config/x.ts', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it('returns the cached RegExp for a repeated pattern', () => {
    expect(globToRegExp('**/cache-me.ts')).toBe(globToRegExp('**/cache-me.ts'));
  });
});

describe('matchesAnyGlob', () => {
  it('matches nothing with an empty pattern list', () => {
    expect(matchesAnyGlob('/repo/a.ts', [])).toBe(false);
  });

  it('normalises Windows separators before matching', () => {
    expect(matchesAnyGlob('C:\\repo\\src\\clock.ts', ['**/src/clock.ts'])).toBe(true);
  });

  it('is true when any pattern matches', () => {
    expect(matchesAnyGlob('/repo/b.ts', ['**/a.ts', '**/b.ts'])).toBe(true);
  });
});

describe('toPosixPath', () => {
  it('turns backslashes into forward slashes', () => {
    expect(toPosixPath('a\\b\\c.ts')).toBe('a/b/c.ts');
  });
});
