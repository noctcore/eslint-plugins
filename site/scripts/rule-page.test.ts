/**
 * The rule page template (CONTRIBUTING.md, "Rule page template") for the
 * packages in RULE_PAGE_PACKAGES: the body checks, the Options table check,
 * the generated message list and the HTML sync.ts shapes from them. Each
 * check gets a negative case, so none of them can quietly pass everything.
 */
import { describe, expect, test } from 'bun:test';

import type { RuleDetails } from './inventory';
import { applyMessagesBlock, MESSAGES_BEGIN, renderMessagesBlock } from './readmes';
import { checkOptionsTable, checkRulePageBody, schemaType } from './structure';
import { messageHtml, optionsLine, repeatsMessages, shapeRulePage } from './sync';

function failures(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const page = [
  '## In short',
  '',
  'The rule flags one thing. It says why in plain words.',
  '',
  '## What you will see',
  '',
  MESSAGES_BEGIN,
  '- `boom`: It went `{{what}}`.',
  '<!-- end generated messages -->',
  '',
  '## Code that triggers it',
  '',
  '### One shape',
  '',
  '```ts bad message=boom',
  'boom();',
  '```',
  '',
  '**The fix:** call the quiet one.',
  '',
  '```ts good',
  'quiet();',
  '```',
  '',
].join('\n');

describe('rule page body', () => {
  test('the template itself passes', () => {
    expect(failures(() => checkRulePageBody(page, 'doc.md'))).toBeNull();
  });

  test('In short must be 2 or 3 plain sentences', () => {
    const one = page.replace(' It says why in plain words.', '');
    expect(failures(() => checkRulePageBody(one, 'doc.md'))).toContain('2 or 3 sentences, found 1');
    const four = page.replace('plain words.', 'plain words. A third. A fourth.');
    expect(failures(() => checkRulePageBody(four, 'doc.md'))).toContain('found 4');
    const list = page.replace('The rule flags one thing.', '- The rule flags one thing.');
    expect(failures(() => checkRulePageBody(list, 'doc.md'))).toContain('plain sentences');
  });

  test('What you will see needs the generated list', () => {
    const bare = page.replace(MESSAGES_BEGIN, '');
    expect(failures(() => checkRulePageBody(bare, 'doc.md'))).toContain('docs:readmes');
  });

  test('each shape is bad, then The fix, then good', () => {
    const noFix = page.replace('**The fix:** call the quiet one.', 'Call the quiet one.');
    expect(failures(() => checkRulePageBody(noFix, 'doc.md'))).toContain('"### One shape" needs');
    const noGood = page.replace('```ts good', '```ts prose');
    expect(failures(() => checkRulePageBody(noGood, 'doc.md'))).toContain('"### One shape" needs');
    const noShape = page.replace('### One shape\n', '');
    expect(failures(() => checkRulePageBody(noShape, 'doc.md'))).toContain('one "###" per shape');
  });
});

const details: RuleDetails = {
  messages: { boom: 'It went `{{what}}`.', quiet: 'Use {{other}}\n  instead.' },
  suggestionIds: ['quiet'],
  optionsSchema: {
    type: 'object',
    properties: {
      max: { type: 'integer' },
      allowIn: { type: 'array', items: { type: 'string' } },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Deprecated alias of `allowIn`.' },
    },
  },
  defaults: { max: 3, allowIn: [] },
};

const table = (rows: string[]) =>
  ['## Options', '', '| Option | Type | Default | Meaning |', '| --- | --- | --- | --- |', ...rows, ''].join('\n');
const good = [
  '| `max` | `integer` | `3` | Most hops. |',
  '| `allowIn` | `string[]` | `[]` | Globs to skip. |',
  '| `ignore` | `string[]` | (none) | Deprecated alias of `allowIn`. |',
];

describe('options table against the schema', () => {
  test('a table that matches passes', () => {
    expect(failures(() => checkOptionsTable(table(good), 'doc.md', details))).toBeNull();
  });

  test('a missing or extra option fails', () => {
    expect(failures(() => checkOptionsTable(table(good.slice(1)), 'doc.md', details))).toContain('missing max');
    const extra = [...good, '| `depth` | `number` | `1` | Made up. |'];
    expect(failures(() => checkOptionsTable(table(extra), 'doc.md', details))).toContain('not in the schema depth');
  });

  test('a wrong type or default fails', () => {
    const type = [good[0]!.replace('`integer`', '`string`'), ...good.slice(1)];
    expect(failures(() => checkOptionsTable(table(type), 'doc.md', details))).toContain('`max` is `integer`');
    const fallback = [good[0]!.replace('`3` |', '`4` |'), ...good.slice(1)];
    expect(failures(() => checkOptionsTable(table(fallback), 'doc.md', details))).toContain('defaults to `3`');
  });

  test('a deprecated alias must say so first', () => {
    const hidden = [...good.slice(0, 2), '| `ignore` | `string[]` | (none) | Old name. |'];
    expect(failures(() => checkOptionsTable(table(hidden), 'doc.md', details))).toContain('deprecated alias');
  });

  test('schema types render the way the docs write them', () => {
    expect(schemaType({ type: 'boolean' })).toBe('boolean');
    expect(schemaType({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(schemaType({ enum: ['a', 'b'] })).toBe("'a' | 'b'");
  });
});

describe('generated message list', () => {
  test('lists every message in meta order, marks suggestions and flattens whitespace', () => {
    const block = renderMessagesBlock(details);
    expect(block).toContain('- `boom`: It went `{{what}}`.');
    expect(block).toContain('- `quiet` (suggestion): Use {{other}} instead.');
    expect(block.indexOf('`boom`')).toBeLessThan(block.indexOf('`quiet`'));
  });

  test('goes under the heading, replaces itself, and needs the heading', () => {
    const fresh = '## What you will see\n\nText.\n';
    const once = applyMessagesBlock(fresh, details, 'doc.md');
    expect(once.indexOf(MESSAGES_BEGIN)).toBeLessThan(once.indexOf('Text.'));
    expect(applyMessagesBlock(once, details, 'doc.md')).toBe(once);
    expect(failures(() => applyMessagesBlock('## Why\n', details, 'doc.md'))).toContain('What you will see');
  });
});

describe('shaped HTML', () => {
  test('a placeholder becomes a slot and code spans stay code', () => {
    expect(messageHtml('It went `{{what}}`.')).toBe('It went <code><var class="ph">what</var></code>.');
    expect(messageHtml('a <b> & {{x}}')).toBe('a &lt;b&gt; &amp; <var class="ph">x</var>');
  });

  test('In short, the message cards and the fix note are shaped', () => {
    const html = shapeRulePage(page.split('\n')).join('\n');
    expect(html).toContain('<div class="rule-inshort">');
    expect(html).toContain('<ul class="rule-messages" role="list">');
    expect(html).toContain('Report');
    expect(html).not.toContain(MESSAGES_BEGIN);
    expect(html).toContain('href="#code-that-triggers-it"');
    expect(html).toContain('<span class="rule-fix-label">The fix</span> Call the quiet one.');
    const named = shapeRulePage([...page.split('\n').slice(0, 9), '`{{what}}` is the thing.', '']).join('\n');
    expect(named).toContain('<var class="ph">what</var> is the thing.');
  });
});

describe('example options', () => {
  test('sit on a labelled line, escaped', () => {
    expect(optionsLine('{"a":"<b>"}')).toBe('<p class="rule-example-options"><span>Options</span> <code>{"a":"&lt;b&gt;"}</code></p>');
  });

  test('the Options table is wrapped so phones can restack it', () => {
    const html = shapeRulePage(['## Options', '', '| Option | Type | Default | Meaning |', '| --- | --- | --- | --- |', '| `a` | `boolean` | `true` | A. |', '', 'After.']).join('\n');
    expect(html).toMatch(/<div class="rule-options">\n\n\| Option[\s\S]*\| A\. \|\n\n<\/div>\n\nAfter\./);
  });
});

describe('repeated output and shape blocks', () => {
  const plain: RuleDetails = { ...details, messages: { plain: 'Do not do that.', filled: 'Use {{x}}.' } };

  test('a report fence that only repeats placeholder-free messages is left out', () => {
    expect(repeatsMessages(['Do not do that.', '', 'Do not   do that.'], plain)).toBe(true);
    expect(repeatsMessages(['Use y.'], plain)).toBe(false);
    expect(repeatsMessages(['Do not do that.', '', 'Use y.'], plain)).toBe(false);
    expect(repeatsMessages(['Do not do that.'], undefined)).toBe(false);
  });

  test('each shape under Code that triggers it is its own section', () => {
    const two = page.replace('## Code that triggers it\n', '## Code that triggers it\n\n### First\n\nText.\n');
    const html = shapeRulePage(two.split('\n')).join('\n');
    expect(html.match(/<section class="rule-shape">/g)?.length).toBe(2);
    expect(html.match(/<\/section>/g)?.length).toBe(2);
    expect(html.indexOf('</div>', html.indexOf('rule-fix-label'))).toBeLessThan(html.lastIndexOf('</section>'));
  });
});
