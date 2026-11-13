/**
 * The search palette (src/lib/search.ts) on the real inventory: one entry per
 * package, rule and lint-meta check, exact ids and names ranked first, and the
 * keyboard shortcuts. The catalog is built here from source, as sync.ts builds
 * it, because CI's test job runs no sync.
 */
import { describe, expect, test } from 'bun:test';

import { buildSearchIndex, highlightHtml, paletteShortcut, searchIndex, type SearchPackage } from '../src/lib/search';
import { STARTER } from '../src/lib/stacks';
import { SITE_BASE, loadInventory } from './inventory';
import { catalogOf } from './sync';

const inventory = await loadInventory('src');
const catalog = catalogOf(inventory);
const index = buildSearchIndex(catalog, `${SITE_BASE}/`);
const allRules = catalog.flatMap((pkg) => pkg.rules.map((rule) => ({ pkg, rule })));

describe('search index', () => {
  test('the index holds one entry per package, rule and lint-meta check', () => {
    const count = (kind: string) => index.filter((entry) => entry.kind === kind).length;
    expect(count('package')).toBe(inventory.length);
    expect(count('rule')).toBe(inventory.filter((pkg) => pkg.kind === 'eslint-plugin').flatMap((pkg) => pkg.rules).length);
    expect(count('check')).toBe(inventory.filter((pkg) => pkg.kind === 'lint-meta').flatMap((pkg) => pkg.rules).length);
    expect(count('check')).toBeGreaterThan(0);
    expect(new Set(index.map((entry) => entry.href)).size).toBe(index.length);
    for (const { pkg, rule } of allRules) {
      expect(index.find((entry) => entry.key === `${pkg.short}/${rule.name}`)?.href).toBe(`${SITE_BASE}/${rule.route}`);
    }
    expect(index.find((entry) => entry.key === 'contracts')?.href).toBe(`${SITE_BASE}/packages/contracts/`);
  });

  test('a full rule id query ranks that rule first', () => {
    for (const { pkg, rule } of allRules) {
      expect(searchIndex(index, rule.id)[0]?.key).toBe(`${pkg.short}/${rule.name}`);
    }
  });

  test('a rule name query ranks that rule first', () => {
    const names = allRules.map(({ rule }) => rule.name);
    const unique = allRules.filter(({ rule }) => names.filter((name) => name === rule.name).length === 1);
    expect(unique.length).toBeGreaterThan(100);
    for (const { pkg, rule } of unique) {
      expect(searchIndex(index, rule.name)[0]?.key).toBe(`${pkg.short}/${rule.name}`);
    }
  });

  test('a package name query ranks the package first', () => {
    expect(searchIndex(index, 'contracts')[0]).toMatchObject({ kind: 'package', key: 'contracts' });
    expect(searchIndex(index, 'Prisma')[0]).toMatchObject({ kind: 'package', key: 'prisma' });
  });

  test('every word must match', () => {
    const results = searchIndex(index, 'fetch timeout', 500);
    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(entry.hay).toContain('fetch');
      expect(entry.hay).toContain('timeout');
    }
    expect(searchIndex(index, 'fetch no-such-word-anywhere')).toEqual([]);
  });

  test('the empty query offers the starter set', () => {
    expect(searchIndex(index, '   ').map((entry) => entry.key)).toEqual(STARTER.map((starter) => starter.short));
  });

  test('results are capped', () => {
    expect(searchIndex(index, 'e', 7)).toHaveLength(7);
  });

  test('an exact rule name outranks a package whose name only starts with it', () => {
    const fixture: SearchPackage[] = [
      { short: 'timeout-kit', npmName: '@x/timeout-kit', kind: 'eslint-plugin', description: 'Kit.', rules: [] },
      {
        short: 'other',
        npmName: '@x/other',
        kind: 'eslint-plugin',
        description: 'Other.',
        rules: [{ name: 'timeout', id: 'x-other/timeout', description: 'Needs a timeout.', route: 'rules/other/timeout/' }],
      },
    ];
    const ranked = searchIndex(buildSearchIndex(fixture, '/'), 'timeout').map((entry) => entry.key);
    expect(ranked).toEqual(['other/timeout', 'timeout-kit']);
  });
});

describe('result highlighting', () => {
  test('query words are marked case-insensitively and the text is escaped', () => {
    expect(highlightHtml('Await the Promise', ['promise'])).toBe('Await the <mark>Promise</mark>');
    expect(highlightHtml('a <b> tag', ['tag'])).toBe('a &lt;b&gt; <mark>tag</mark>');
  });

  test('a word matching an entity name never lands inside the entity', () => {
    for (const word of ['amp', 'lt', 'gt', 'quot']) {
      expect(highlightHtml('a < b > c & "d"', [word])).toBe('a &lt; b &gt; c &amp; &quot;d&quot;');
    }
    expect(highlightHtml('ample & salt', ['amp', 'lt'])).toBe('<mark>amp</mark>le &amp; sa<mark>lt</mark>');
  });

  test('overlapping words merge into one mark and one-letter words are not marked', () => {
    expect(highlightHtml('no-floating-promises', ['float', 'oating'])).toBe('no-<mark>floating</mark>-promises');
    expect(highlightHtml('a & b', ['a', '&'])).toBe('a &amp; b');
    expect(highlightHtml('<a & b>', ['<a'])).toBe('<mark>&lt;a</mark> &amp; b&gt;');
    expect(highlightHtml('', ['x'])).toBe('');
  });
});

describe('palette shortcuts', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });
  const body = { tagName: 'BODY', isContentEditable: false };

  test('Ctrl+K and Cmd+K toggle', () => {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(paletteShortcut(key('k', mods), body, false)).toBe('open');
      expect(paletteShortcut(key('k', mods), body, true)).toBe('close');
      expect(paletteShortcut(key('K', mods), { tagName: 'INPUT', isContentEditable: false }, false)).toBe('open');
    }
    expect(paletteShortcut(key('k'), body, false)).toBeNull();
  });

  test('slash opens outside a text field, and only when closed', () => {
    expect(paletteShortcut(key('/'), body, false)).toBe('open');
    expect(paletteShortcut(key('/'), null, false)).toBe('open');
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(paletteShortcut(key('/'), { tagName, isContentEditable: false }, false)).toBeNull();
    }
    expect(paletteShortcut(key('/'), { tagName: 'DIV', isContentEditable: true }, false)).toBeNull();
    expect(paletteShortcut(key('/'), body, true)).toBeNull();
  });

  test('Escape closes an open palette and is ignored otherwise', () => {
    expect(paletteShortcut(key('Escape'), body, true)).toBe('close');
    expect(paletteShortcut(key('Escape'), body, false)).toBeNull();
  });
});
