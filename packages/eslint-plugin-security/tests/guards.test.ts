import { describe, expect, it } from 'vitest';

import { regexAdmitsOnlySafe, regexPinsHost } from '../src/guards';

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

  it('rejects the m and v flags', () => {
    expect(safe('^[a-z]+$', 'shell', 'm')).toBe(false);
    // With `v`, classes can nest (`[[a-z]--[aeiou]]`), which this reader does not handle.
    expect(safe('^[[a-z]--[aeiou]]+$', 'shell', 'v')).toBe(false);
  });
});

describe('regexPinsHost', () => {
  it.each(['^example\\.com$', '^(app|docs)\\.example\\.com$', '^[a-z]+\\.example\\.com$'])('pins %s', (pattern) => {
    expect(regexPinsHost(pattern, '')).toBe(true);
  });

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
