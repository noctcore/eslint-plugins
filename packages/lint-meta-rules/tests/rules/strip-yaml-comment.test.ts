import { describe, expect, test } from 'bun:test';

import { stripYamlComment } from '../../src/rules/shared';

describe('stripYamlComment', () => {
  test('strips a comment that starts the line or follows whitespace', () => {
    expect(stripYamlComment('# a comment')).toBe('');
    expect(stripYamlComment('cache: pnpm # restore')).toBe('cache: pnpm');
    expect(stripYamlComment('cache: pnpm\t# restore')).toBe('cache: pnpm');
  });

  test('keeps a # that does not follow whitespace', () => {
    expect(stripYamlComment('uses: org/action@v1#frag')).toBe('uses: org/action@v1#frag');
    expect(stripYamlComment('run: echo "a#b"')).toBe('run: echo "a#b"');
  });

  test('strips the comment on a CRLF line, carriage return included', () => {
    expect(stripYamlComment('cache: pnpm # restore\r')).toBe('cache: pnpm');
    expect(stripYamlComment('# only a comment\r')).toBe('');
    expect(stripYamlComment('cache: pnpm\r')).toBe('cache: pnpm\r');
  });

  test('stays linear on a long run of " #"', () => {
    const line = `x${' #'.repeat(50_000)}`;
    const start = performance.now();

    expect(stripYamlComment(line)).toBe('x');
    expect(performance.now() - start).toBeLessThan(200);
  });
});
