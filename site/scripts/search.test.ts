/**
 * The search palette (src/lib/search.ts) on the real inventory: one entry per
 * package, rule and lint-meta check, exact ids and names ranked first, and the
 * keyboard shortcuts. The catalog is built here from source, as sync.ts builds
 * it, because CI's test job runs no sync.
 */
import { describe, expect, test } from 'bun:test';

import { buildSearchIndex, paletteShortcut, searchIndex } from '../src/lib/search';
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
