/**
 * A rule page's header: the doc's summary as the lead paragraph (sync.ts),
 * and the facts panel the page's components render beside it
 * (src/lib/facts.ts). Same cells in the same order on every page, a chip
 * where a value is a state, plain text for a yes or no, and `is-no` on a
 * negative. Proven on fixtures so every branch is covered, then on the real
 * inventory so no rule falls outside them.
 */
import { describe, expect, test } from 'bun:test';

import { factsPanel } from '../src/lib/facts';
import { SITE_BASE, loadInventory, type PackageEntry, type RuleEntry } from './inventory';
import { renderRuleDoc } from './sync';

const inventory = await loadInventory('src');

function rule(overrides: Partial<RuleEntry> = {}): RuleEntry {
  return {
    name: 'some-rule',
    id: 'noctcore-fixture/some-rule',
    description: 'Fixture rule.',
    recommended: 'error',
    strict: null,
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

/** The panel's cells as `label: value` pairs, with ` (no)` after a quiet value. */
function cells(html: string): string[] {
  return [...html.matchAll(/<div><dt>([^<]+)<\/dt><dd( class="is-no")?>(.*?)<\/dd><\/div>/g)].map(
    ([, label, quiet, value]) => `${label}: ${value}${quiet ? ' (no)' : ''}`,
  );
}

const panel = (pkg: PackageEntry, entry: RuleEntry) => factsPanel(pkg, entry, SITE_BASE);

describe('facts panel', () => {
  test('a rule on in the recommended preset, with nothing else set', () => {
    expect(cells(panel(plugin, rule()))).toEqual([
      `Package: <a href="${SITE_BASE}/packages/fixture/">fixture</a> <span class="facts-note">v1.2.3</span>`,
      'Preset: recommended',
      'Severity: <span class="chip chip-error">error</span>',
      'Autofix: No (no)',
      'Suggestions: No (no)',
      'Options: None (no)',
      'Type info: Not needed (no)',
    ]);
  });

  test('an opt-in rule with every capability', () => {
    const html = panel(
      plugin,
      rule({ recommended: 'off', fixable: true, hasSuggestions: true, requiresOptions: true, hasOptions: true, typeInfo: 'required' }),
    );
    expect(cells(html).slice(1)).toEqual([
      'Preset: none <span class="chip chip-opt">opt-in</span> (no)',
      'Severity: <span class="chip chip-off">off</span>',
      'Autofix: <code>--fix</code>',
      'Suggestions: Yes',
      'Options: <span class="chip chip-options">Required</span>',
      'Type info: <span class="chip chip-types">required</span>',
    ]);
  });

  test('a rule left out of the preset, with optional options and optional types', () => {
    const html = panel(plugin, rule({ recommended: null, hasOptions: true, typeInfo: 'optional' }));
    expect(cells(html)).toContain('Preset: none <span class="chip chip-opt">opt-in</span> (no)');
    expect(cells(html)).toContain('Severity: <span class="chip chip-off">off</span>');
    expect(cells(html)).toContain('Options: Optional');
    expect(cells(html)).toContain('Type info: <span class="chip chip-types">optional</span>');
  });

  test('a house rule on only in the strict preset', () => {
    const html = panel(plugin, rule({ recommended: null, strict: 'error' }));
    expect(cells(html)).toContain('Preset: strict');
    expect(cells(html)).toContain('Severity: <span class="chip chip-error">error</span>');
  });

  test('the rule id is shown and copyable', () => {
    const html = panel(plugin, rule());
    expect(html).toContain('<span class="rule-id-label">Rule id</span>');
    expect(html).toContain('data-copy-text="noctcore-fixture/some-rule" aria-label="Copy rule id"');
    expect(html).toContain('<code>noctcore-fixture/some-rule</code>');
  });

  test('a lint-meta rule gets the harness cells', () => {
    const lintMeta: PackageEntry = { ...plugin, short: 'lint-meta-rules', kind: 'lint-meta', namespace: null };
    const html = panel(
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

  test('every real rule gets a complete panel', () => {
    for (const pkg of inventory) {
      for (const entry of pkg.rules) {
        const html = panel(pkg, entry);
        expect(html.startsWith('<div class="rule-facts">')).toBe(true);
        expect(html).toContain(`data-copy-text="${entry.id}"`);
        const expected = (pkg.kind === 'lint-meta' ? 6 : 7) + (entry.deprecated ? 1 : 0);
        expect(cells(html)).toHaveLength(expected);
      }
    }
  });
});

describe('rule page header', () => {
  test('the summary becomes the lead, the blockquote is gone, and the facts stay out of the body', () => {
    const sections = ['Why', 'What it flags', 'What it does not flag', 'When not to use it'];
    const body = sections.map((section) => `## ${section}\n\nText.\n`).join('\n');
    const doc = `# \`noctcore-fixture/some-rule\`\n\n> Checks \`x\` twice.\n> **Opt-in.**\n\n${body}`;
    const page = renderRuleDoc(doc, '/repo/packages/eslint-plugin-fixture/docs/rules/some-rule.md', plugin, rule());
    const rendered = page.slice(page.indexOf('---\n', 4) + 4);
    expect(rendered.startsWith('\n<div class="rule-lead">\n\nChecks `x` twice.\n**Opt-in.**\n\n</div>\n\n## Why')).toBe(true);
    expect(rendered).not.toMatch(/^>/m);
    expect(rendered).not.toContain('rule-facts');
  });
});
