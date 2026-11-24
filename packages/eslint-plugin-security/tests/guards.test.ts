import { ruleTester } from '@noctcore/eslint-test-utils';
import { AST_NODE_TYPES, type TSESLint } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import {
  type GuardContext,
  isSameSitePath,
  regexAdmitsOnlySafe,
  regexPinsHost,
  regexPinsLocalPath,
} from '../src/guards';

const safe = (pattern: string, context: GuardContext, flags = ''): boolean =>
  regexAdmitsOnlySafe(pattern, flags, context);

describe('regexAdmitsOnlySafe', () => {
  it.each([
    ['^[a-z0-9_][a-z0-9_-]*$', 'shell'],
    ['^[a-z0-9_-]+$', 'path'],
    ['^(asc|desc)$', 'shell'],
    ['^\\d{1,6}$', 'path'],
    ['^[\\w-][\\w.-]*$', 'path'],
    ['^[\\w-][\\w.-]*$', 'shell-path'],
    ['^[a-z.]+$', 'shell-word'],
    ['^[a-zA-Z0-9 _.#%-]+$', 'html'],
    ['^[a-z]*$', 'html'],
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
    // Whitespace splits one value into several arguments.
    ['^[\\w .-]+$', 'shell'],
    ['^[a-z\t]+$', 'shell'],
    ['^[a-z\\s]+$', 'shell'],
    // A leading `-` makes the value an option, a leading `#` a comment.
    ['^[a-z0-9_-]+$', 'shell'],
    ['^-?[a-z]+$', 'shell'],
    ['^[a-z]*-[a-z]+$', 'shell'],
    ['^[a-z#]+$', 'shell'],
    ['^(-|a)[a-z]+$', 'shell'],
    // A value that can be empty drops out of the command or names the base directory.
    ['^[a-z]*$', 'shell'],
    ['^[a-z]{0,8}$', 'shell'],
    ['^([a-z]+)?$', 'shell-word'],
    ['^[a-z0-9_]*$', 'path'],
    // `.` and `..` name the directory itself and its parent.
    ['^[\\w.-]+$', 'path'],
    ['^\\.\\.?$', 'path'],
    ['^[a-z.]+$', 'path'],
    // A word glued after a `/` is a path segment: no `.`, `..` or empty value.
    ['^[a-z.]+$', 'shell-path'],
    ['^[\\w.-]+$', 'shell-path'],
    ['^[a-z]*$', 'shell-path'],
    // A program name is proven by a literal allowlist only.
    ['^[a-z]+$', 'command'],
    ['^(git|ls)$', 'command'],
    // `{00}` and `{00,}` allow zero repetitions as `{0}` does, so `-` can lead.
    ['^a{00}[-a-z]+$', 'shell'],
    ['^a{00,3}[-a-z]+$', 'shell'],
    ['^\\x61{00}[-a-z]+$', 'shell'],
    // Lookarounds and back references are not read.
    ['^(?=a)[a-z]+$', 'shell'],
    ['^(a)\\1$', 'shell'],
  ] as const)('rejects %s for %s', (pattern, context) => {
    expect(safe(pattern, context)).toBe(false);
  });

  it('reads Unicode letter and number classes with the u flag only', () => {
    expect(safe('^[\\p{L}\\p{N}_]+$', 'shell', 'u')).toBe(true);
    expect(safe('^\\p{Letter}+$', 'html', 'u')).toBe(true);
    // Without `u`, `\\p` is not a property escape.
    expect(safe('^[\\p{L}]+$', 'shell')).toBe(false);
    // Other properties are not read.
    expect(safe('^\\p{P}+$', 'html', 'u')).toBe(false);
    expect(safe('^\\P{L}+$', 'html', 'u')).toBe(false);
  });

  it('allows a leading - or # only inside a shell word', () => {
    expect(safe('^[\\w.-]+$', 'shell')).toBe(false);
    expect(safe('^[\\w.-]+$', 'shell-word')).toBe(true);
    expect(safe('^[\\w #]+$', 'shell-word')).toBe(false);
  });

  it('rejects the m and v flags', () => {
    expect(safe('^[a-z]+$', 'shell', 'm')).toBe(false);
    // With `v`, classes can nest (`[[a-z]--[aeiou]]`), which this reader does not handle.
    expect(safe('^[[a-z]--[aeiou]]+$', 'shell', 'v')).toBe(false);
  });
});

describe('regexPinsHost', () => {
  it.each([
    '^example\\.com$',
    '^(app|docs)\\.example\\.com$',
    '^[a-z]+\\.example\\.com$',
    // An anchored group of subdomains ending in a literal dot.
    '^(?:[a-z0-9-]+\\.)*example\\.com$',
    '^([a-z]+\\.)?example\\.com$',
    // An alternation of exact domains.
    '^(app\\.example\\.com|docs\\.example\\.org)$',
    '^(?:app|docs)\\.example\\.com$',
    // An origin: the host starts after a literal `://`.
    '^https:\\/\\/example\\.com$',
    '^https:\\/\\/(?:[a-z0-9-]+\\.)?example\\.com$',
    // A public suffix with one more literal label before it.
    '^[a-z0-9-]+\\.myapp\\.vercel\\.app$',
    '^(?:[a-z0-9-]+\\.)*docs\\.github\\.io$',
    '^[a-z]+\\.example\\.co\\.uk$',
    '^https:\\/\\/[a-z0-9-]+\\.preview\\.pages\\.dev$',
  ])('pins %s', (pattern) => {
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
    // A class or quantified atom that can end in a label character before the domain.
    '^[a-z0-9.-]*example\\.com$',
    '^[\\w.-]*example\\.com$',
    '^[a-z]+example\\.com$',
    '^https:\\/\\/[a-z0-9.-]*example\\.com$',
    // A bare top-level domain.
    '^[a-z0-9-]+\\.com$',
    '^com$',
    '^(?:[a-z]+\\.)*com$',
    // An optional dot, or a group that can end without one.
    '^[a-z]+\\.?example\\.com$',
    '^[a-z]+(?:\\.)?example\\.com$',
    '^[a-z]*(?:a|b\\.)example\\.com$',
    '^[a-z]*(?:|b\\.)example\\.com$',
    // One alternative that ends in a bare TLD or after a class.
    '^(app\\.example\\.com|[a-z]+\\.com)$',
    '^(app\\.example\\.com|[a-z]*example\\.com)$',
    // An empty label.
    '^\\.example\\.com$',
    // A public suffix: anyone can register a label under it.
    '^[a-z0-9-]+\\.vercel\\.app$',
    '^[a-z0-9-]+\\.github\\.io$',
    '^(?:[a-z0-9-]+\\.)*netlify\\.app$',
    '^[a-z0-9-]+\\.pages\\.dev$',
    '^[a-z0-9-]+\\.co\\.uk$',
    '^[a-z0-9-]+\\.Vercel\\.App$',
    '^https:\\/\\/[a-z0-9-]+\\.vercel\\.app$',
    '^(app\\.example\\.com|[a-z0-9-]+\\.vercel\\.app)$',
    // A label that only starts literally is not a literal label.
    '^myapp-[a-z0-9-]+\\.vercel\\.app$',
    // The suffix alone.
    '^vercel\\.app$',
    '^co\\.uk$',
  ])('does not pin %s', (pattern) => {
    expect(regexPinsHost(pattern, '')).toBe(false);
  });

  it('rejects the m flag', () => {
    expect(regexPinsHost('^example\\.com$', 'm')).toBe(false);
  });
});

describe('regexPinsLocalPath', () => {
  it.each([
    '^\\/[a-z0-9]',
    '^/[a-z][\\w/-]*$',
    '^\\/[^\\/\\\\\\s]',
    '^\\/[^\\/\\\\\\t\\n\\r]',
    '^\\/\\d+$',
    '^\\/\\x61{01}',
    '^\\/(?![\\/\\\\\\s])[\\w\\t]+$',
  ])(
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
    // optional second character, however the count or the character is spelled
    '^\\/[a-z]?',
    '^\\/[a-z]*',
    '^\\/[a-z]{0,3}',
    '^\\/[a-z]{00}',
    '^\\/[a-z]{00,2}',
    '^\\/\\x61?',
    '^\\/\\u0061*',
    '^\\/\\x61{0}',
    '^\\/[^\\/\\\\\\s]?',
    '^\\/[^\\/\\\\\\s]{00}',
    // a tab or line break right after the `/` is dropped by browsers
    '^\\/[^\\/\\\\\\n\\r]',
    '^\\/[\\w\\t]',
    '^\\/\\t',
    '^\\/[\\x00-\\x7f]',
    '^\\/(?!\\/|\\\\)[\\w\\t]+$',
    '^\\/(?![\\/\\\\])\\s+$',
    '^\\/(?!\\/)a{00}\\\\x$',
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

/** Reports `redirect(x)` unless `isSameSitePath` proves `x` stays on the site. */
const sameSiteProbe: TSESLint.RuleModule<'notSameSite'> = {
  defaultOptions: [],
  meta: {
    type: 'problem',
    schema: [],
    messages: { notSameSite: 'not proven same-site' },
  },
  create(context) {
    return {
      CallExpression(node): void {
        const target = node.arguments[0];
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === 'redirect' &&
          target !== undefined &&
          !isSameSitePath(target, node, context.sourceCode)
        ) {
          context.report({ node, messageId: 'notSameSite' });
        }
      },
    };
  },
};

const TS = 'guard.ts';
const notSameSite = [{ messageId: 'notSameSite' as const }];
/** The checks that refuse `//` and `/\` after a leading `/`. */
const SLASHES = String.raw`!x.startsWith('/') || x.startsWith('//') || x.startsWith('/\\')`;

ruleTester.run('isSameSitePath', sameSiteProbe, {
  valid: [
    // Each tab or line break refused with `includes` or `startsWith('/<c>')`.
    {
      code: String.raw`function h(x: string) { if (${SLASHES} || x.includes('\t') || x.includes('\n') || x.includes('\r')) return; redirect(x); }`,
      filename: TS,
    },
    {
      code: String.raw`function h(x: string) { if (${SLASHES} || x.startsWith('/\t') || x.startsWith('/\n') || x.startsWith('/\r')) return; redirect(x); }`,
      filename: TS,
    },
    // `includes` through `String(x)` or a template searches the text.
    {
      code: String.raw`function h(x) { if (!String(x).startsWith('/') || String(x).startsWith('//') || String(x).includes('\\') || ${'`${x}`'}.includes('\t') || String(x).includes('\n') || String(x).includes('\r')) return; redirect(x); }`,
      filename: TS,
    },
    // A one-class regex that matches any string holding one of them.
    {
      code: String.raw`function h(x: string) { if (!x.startsWith('/') || x.startsWith('//') || /[\s\\]/.test(x)) return; redirect(x); }`,
      filename: TS,
    },
    {
      code: String.raw`const BAD = /[\\\t\n\r]/; function h(x: string) { if (!x.startsWith('/') || x.startsWith('//') || BAD.test(x)) return; redirect(x); }`,
      filename: TS,
    },
    // The positive form around the sink.
    {
      code: String.raw`function h(x: string) { if (x.startsWith('/') && !x.startsWith('//') && !x.includes('\\') && !/\s/.test(x)) { redirect(x); } }`,
      filename: TS,
    },
    // A local-path regex that refuses all five characters.
    {
      code: String.raw`function h(x: string) { if (!/^\/[^\/\\\s]/.test(x)) return; redirect(x); }`,
      filename: TS,
    },
  ],
  invalid: [
    // `/<tab>/evil.com` passes these checks and a browser goes to evil.com.
    {
      code: String.raw`function h(x: string) { if (${SLASHES}) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    {
      code: String.raw`function h(x: string) { if (!x.startsWith('/') || x.startsWith('//') || x.includes('\\')) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    // `\r` left open.
    {
      code: String.raw`function h(x: string) { if (${SLASHES} || x.includes('\t') || x.includes('\n')) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    {
      code: String.raw`function h(x: string) { if (x.startsWith('/') && !x.startsWith('//') && !x.startsWith('/\\')) { redirect(x); } }`,
      filename: TS,
      errors: notSameSite,
    },
    // A `g` or `y` regex starts at `lastIndex`, so it can miss the character.
    {
      code: String.raw`const BAD = /[\s\\]/g; function h(x: string) { if (!x.startsWith('/') || x.startsWith('//') || BAD.test(x)) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    // An anchored regex only looks at one place.
    {
      code: String.raw`function h(x: string) { if (!x.startsWith('/') || x.startsWith('//') || /^[\s\\]/.test(x)) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    // `String(x)` proves the slash, but a bare `x` may be an array, whose
    // `includes` compares whole elements: `['/\t/evil.com'].includes('\t')` is false.
    {
      code: String.raw`function h(x) { if (!String(x).startsWith('/') || String(x).startsWith('//') || String(x).startsWith('/\\') || x.includes('\t') || x.includes('\n') || x.includes('\r')) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    {
      code: String.raw`function h(x) { if (!String(x).startsWith('/') || String(x).startsWith('//') || x.includes('\\') || /\s/.test(x)) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    // Local-path regexes that let a tab, or nothing, follow the `/`.
    {
      code: String.raw`function h(x: string) { if (!/^\/[^\/\\]/.test(x)) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
    {
      code: String.raw`function h(x: string) { if (!/^\/\x61?/.test(x)) return; redirect(x); }`,
      filename: TS,
      errors: notSameSite,
    },
  ],
});
