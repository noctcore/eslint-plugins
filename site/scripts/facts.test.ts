/**
 * The header a rule page gets from sync.ts: the doc's summary as the lead
 * paragraph, then the facts strip. Same cells in the same order on every page,
 * a badge where a value is a state, plain text for a yes or no, and `is-no` on
 * a negative. Proven on fixtures so every branch is covered, then on the real
 * inventory so no rule falls outside them.
 */
import { describe, expect, test } from 'bun:test';

import { SITE_BASE, loadInventory, type PackageEntry, type RuleEntry } from './inventory';
import { factsStrip, renderRuleDoc } from './sync';

const inventory = await loadInventory('src');

function rule(overrides: Partial<RuleEntry> = {}): RuleEntry {
  return {
    name: 'some-rule',
    id: 'noctcore-fixture/some-rule',
    description: 'Fixture rule.',
    recommended: 'error',
    fixable: false,
    hasSuggestions: false,
    typeInfo: 'none',
    requiresOptions: false,
    hasOptions: false,
    deprecated: false,
    replacedBy: [],
    deprecatedSince: null,
    deprecationMessage: null,
    docsUrl: null,
    ...overrides,
  };
}

const plugin: PackageEntry = {
  short: 'fixture',
  npmName: '@noctcore/eslint-plugin-fixture',
  kind: 'eslint-plugin',
  namespace: 'noctcore-fixture',
  version: '1.2.3',
  description: 'Fixture plugin.',
  dir: '/repo/packages/eslint-plugin-fixture',
  rules: [],
};

/** The strip as `label: value` pairs, with ` (no)` after a quiet value. */
function cells(html: string): string[] {
  return [...html.matchAll(/<div><dt>([^<]+)<\/dt><dd( class="is-no")?>(.*?)<\/dd><\/div>/g)].map(
    ([, label, quiet, value]) => `${label}: ${value}${quiet ? ' (no)' : ''}`,
  );
}

describe('facts strip', () => {
  test('a rule on in the preset, with nothing else set', () => {
    expect(cells(factsStrip(plugin, rule()))).toEqual([
      `Package: <a href="${SITE_BASE}/packages/fixture/"><code>fixture</code></a><wbr><span class="nc-facts-note">v1.2.3</span>`,
      'Recommended preset: <span class="nc-badge nc-badge--on">error</span>',
      'Autofix: No (no)',
      'Suggestions: No (no)',
      'Options: None (no)',
      'Type information: Not needed (no)',
    ]);
  });

  test('an opt-in rule with every capability', () => {
    const html = factsStrip(
      plugin,
      rule({ recommended: 'off', fixable: true, hasSuggestions: true, requiresOptions: true, hasOptions: true, typeInfo: 'required' }),
    );
    expect(cells(html).slice(1)).toEqual([
      'Recommended preset: <span class="nc-badge nc-badge--off">off</span><span class="nc-optin">opt-in</span>',
      'Autofix: Yes',
      'Suggestions: Yes',
      'Options: <span class="nc-badge nc-badge--options">Required</span>',
      'Type information: <span class="nc-badge nc-badge--types">required</span>',
    ]);
  });

  test('a rule left out of the preset, with optional options and optional types', () => {
    const html = factsStrip(plugin, rule({ recommended: null, hasOptions: true, typeInfo: 'optional' }));
    expect(cells(html)).toContain(
      'Recommended preset: <span class="nc-badge nc-badge--out">not listed</span><span class="nc-optin">opt-in</span>',
    );
    expect(cells(html)).toContain('Options: Optional');
    expect(cells(html)).toContain('Type information: <span class="nc-badge nc-badge--types">optional</span>');
  });

  test('a lint-meta rule gets the harness cells', () => {
    const lintMeta: PackageEntry = { ...plugin, short: 'lint-meta-rules', kind: 'lint-meta', namespace: null };
    const html = factsStrip(
      lintMeta,
      rule({ factory: 'createThingRule', entry: '@noctcore/lint-meta-rules/i18n', category: 'source-text', ciCritical: false }),
    );
    expect(cells(html).map((cell) => cell.split(':')[0])).toEqual([
      'Package',
      'Runs under',
      'Factory',
      'Entry point',
      'Category',
      'Fails CI by default',
    ]);
    expect(cells(html)).toContain('Fails CI by default: No (no)');
  });

  test('every real rule gets a complete strip', () => {
    for (const pkg of inventory) {
      for (const entry of pkg.rules) {
        const html = factsStrip(pkg, entry);
        expect(html.startsWith('<dl class="nc-facts">')).toBe(true);
        expect(cells(html)).toHaveLength(entry.deprecated ? 7 : 6);
      }
    }
  });
});

describe('rule page header', () => {
  test('the summary becomes the lead, above the facts strip, and the blockquote is gone', () => {
    const sections = ['Why', 'What it flags', 'What it does not flag', 'When not to use it'];
    const body = sections.map((section) => `## ${section}\n\nText.\n`).join('\n');
    const doc = `# \`noctcore-fixture/some-rule\`\n\n> Checks \`x\` twice.\n> **Opt-in.**\n\n${body}`;
    const page = renderRuleDoc(doc, '/repo/packages/eslint-plugin-fixture/docs/rules/some-rule.md', plugin, rule());
    const rendered = page.slice(page.indexOf('---\n', 4) + 4);
    expect(rendered.startsWith('\n<div class="nc-lead">\n\nChecks `x` twice.\n**Opt-in.**\n\n</div>\n\n<dl class="nc-facts">')).toBe(
      true,
    );
    expect(rendered).not.toMatch(/^>/m);
  });
});
