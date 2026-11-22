import { describe, expect, it } from 'vitest';

import { regexAdmitsOnlySafe, regexPinsHost, regexPinsLocalPath } from '../src/guards';

const safe = (pattern: string, context: 'shell' | 'html' | 'path', flags = ''): boolean =>
  regexAdmitsOnlySafe(pattern, flags, context);

describe('regexAdmitsOnlySafe', () => {
  it.each([
    ['^[a-z0-9_-]+$', 'shell'],
    ['^(asc|desc)$', 'shell'],
    ['^\\d{1,6}$', 'path'],
    ['^[\\w.-]+$', 'path'],
    ['^[a-zA-Z0-9 _.#%-]+$', 'html'],
    ['^[\\]a]+$', 'html'],
    ['^(?:a|b)(?<n>c)$', 'shell'],
  ] as const)('accepts %s for %s', (pattern, context) => {
    expect(safe(pattern, context)).toBe(true);
  });

  it.each([
    // `[]` is an empty class in JavaScript; the `.*` after it is a real alternative.
    ['^([]|.*|[a])$', 'html'],
    ['^([]|.*|[a])$', 'path'],
    ['^[]a]+$', 'shell'],
    // `[^]` matches anything; negated classes are not read.
    ['^[^]+$', 'html'],
    ['^[^<>]+$', 'html'],
    // Unanchored, half-anchored or anchored per alternative.
    ['[a-z]+', 'shell'],
    ['^[a-z]+', 'shell'],
    ['^a|b$', 'shell'],
    // Unsafe characters through a class, an escape, a range or a wildcard.
    ['^[a-z;]+$', 'shell'],
    ['^[\\w/]+$', 'path'],
    ['^[\\w<]+$', 'html'],
    ['^[ -~]+$', 'html'],
    ['^\\S+$', 'shell'],
    ['^a.b$', 'shell'],
    // Lookarounds and back references are not read.
    ['^(?=a)[a-z]+$', 'shell'],
    ['^(a)\\1$', 'shell'],
  ] as const)('rejects %s for %s', (pattern, context) => {
    expect(safe(pattern, context)).toBe(false);
  });

  it('reads Unicode letter and number classes with the u flag only', () => {
    expect(safe('^[\\p{L}\\p{N}_-]+$', 'shell', 'u')).toBe(true);
    expect(safe('^\\p{Letter}+$', 'html', 'u')).toBe(true);
    // Without `u`, `\\p` is not a property escape.
    expect(safe('^[\\p{L}]+$', 'shell')).toBe(false);
    // Other properties are not read.
    expect(safe('^\\p{P}+$', 'html', 'u')).toBe(false);
    expect(safe('^\\P{L}+$', 'html', 'u')).toBe(false);
  });

  it('rejects the m and v flags', () => {
    expect(safe('^[a-z]+$', 'shell', 'm')).toBe(false);
    // With `v`, classes can nest (`[[a-z]--[aeiou]]`), which this reader does not handle.
    expect(safe('^[[a-z]--[aeiou]]+$', 'shell', 'v')).toBe(false);
  });
});

describe('regexPinsHost', () => {
  it.each(['^example\\.com$', '^(app|docs)\\.example\\.com$', '^[a-z]+\\.example\\.com$'])(
    'pins %s',
    (pattern) => {
      expect(regexPinsHost(pattern, '')).toBe(true);
    },
  );

  it.each([
    'example\\.com$',
    '^example.com$',
    '^.*\\.example\\.com$',
    '^(app|[a-z]+)$',
    '^(app\\.example\\.com|.*)$',
    '^([]|.*)\\.example\\.com$',
    '^[^]+$',
    '^app\\.example\\.com$|^evil$',
  ])('does not pin %s', (pattern) => {
    expect(regexPinsHost(pattern, '')).toBe(false);
  });

  it('rejects the m flag', () => {
    expect(regexPinsHost('^example\\.com$', 'm')).toBe(false);
  });
});

describe('regexPinsLocalPath', () => {
  it.each(['^\\/[a-z0-9]', '^/[a-z][\\w/-]*$', '^\\/[^\\/\\\\\\s]', '^\\/\\d+$'])(
    'keeps %s on the site',
    (pattern) => {
      expect(regexPinsLocalPath(pattern, '')).toBe(true);
    },
  );

  it.each([
    // the second character may be `/`, a backslash or a tab
    '^\\/[\\w/-]*$',
    '^\\/[^\\/\\\\]',
    '^\\/.',
    '^\\/\\S',
    // optional second character
    '^\\/[a-z]?',
    '^\\/[a-z]*',
    '^\\/[a-z]{0,3}',
    // not anchored, or an alternative
    '\\/[a-z]',
    '^\\/[a-z]|^https:',
  ])('does not pin %s', (pattern) => {
    expect(regexPinsLocalPath(pattern, '')).toBe(false);
  });

  it('rejects the m flag', () => {
    expect(regexPinsLocalPath('^\\/[a-z]', 'm')).toBe(false);
  });
});
