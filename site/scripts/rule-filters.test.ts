/**
 * The All rules filter (src/lib/rule-filters.ts) on the real inventory. The
 * catalog is built here from source, as sync.ts builds it, because CI's test
 * job runs no sync. Expected counts are computed from the inventory itself, so
 * a new rule never needs a test edit.
 */
import { describe, expect, test } from 'bun:test';

import { EMPTY_FILTER, filterRules, ruleRows, type FilterRow, type RuleFilter } from '../src/lib/rule-filters';
import { loadInventory } from './inventory';
import { catalogOf } from './sync';

const inventory = await loadInventory('src');
const rows = ruleRows(catalogOf(inventory));
const pluginRules = inventory.filter((pkg) => pkg.kind === 'eslint-plugin').flatMap((pkg) => pkg.rules);
const keys = (list: readonly FilterRow[]) => list.map((row) => row.key);
const run = (filter: Partial<RuleFilter>) => filterRules(rows, { ...EMPTY_FILTER, ...filter });

describe('all rules filter', () => {
  test('the empty filter returns every rule in the catalog', () => {
    const total = inventory.reduce((sum, pkg) => sum + pkg.rules.length, 0);
    const all = run({});
    expect(all).toHaveLength(total);
    expect(new Set(keys(all)).size).toBe(total);
    expect(all.some((row) => row.kind === 'lint-meta')).toBe(true);
  });

  test('preset narrows', () => {
    expect(run({ preset: 'recommended' })).toHaveLength(pluginRules.filter((rule) => rule.recommended === 'error').length);
    expect(run({ preset: 'strict' })).toHaveLength(
      pluginRules.filter((rule) => rule.recommended !== 'error' && rule.strict === 'error').length,
    );
    expect(run({ preset: 'opt-in' })).toHaveLength(
      pluginRules.filter((rule) => rule.recommended !== 'error' && rule.strict !== 'error').length,
    );
    for (const preset of ['recommended', 'strict', 'opt-in'] as const) {
      expect(run({ preset }).length).toBeGreaterThan(0);
      expect(run({ preset }).every((row) => row.kind === 'eslint-plugin')).toBe(true);
    }
  });

  test('--fix and type info narrow', () => {
    const fixable = run({ fix: true });
    expect(fixable.length).toBeGreaterThan(0);
    expect(fixable.every((row) => row.fixable)).toBe(true);
    expect(fixable).toHaveLength(inventory.flatMap((pkg) => pkg.rules).filter((rule) => rule.fixable).length);
    const typed = run({ types: true });
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.every((row) => row.typeInfo !== 'none')).toBe(true);
    expect(typed).toHaveLength(inventory.flatMap((pkg) => pkg.rules).filter((rule) => rule.typeInfo !== 'none').length);
  });

  test('text narrows by every word', () => {
    const timeout = run({ text: 'timeout' });
    expect(keys(timeout)).toContain('async-safety/require-fetch-timeout');
    for (const row of timeout) {
      expect(`${row.name} ${row.id} ${row.description} ${row.short}`.toLowerCase()).toContain('timeout');
    }
    const fetch = new Set(keys(run({ text: 'fetch' })));
    const both = run({ text: '  Fetch   TIMEOUT ' });
    expect(both.length).toBeGreaterThan(0);
    expect(keys(both)).toEqual(keys(timeout).filter((key) => fetch.has(key)));
    expect(run({ text: 'no-such-word-anywhere' })).toHaveLength(0);
  });

  test('a package name matches its rules', () => {
    const prisma = run({ text: 'prisma' });
    const prismaRules = inventory.find((pkg) => pkg.short === 'prisma')!.rules.length;
    expect(prisma.filter((row) => row.short === 'prisma')).toHaveLength(prismaRules);
  });

  test('filters combine', () => {
    const combined = run({ text: 'fetch', preset: 'recommended', fix: true });
    const byText = new Set(keys(run({ text: 'fetch' })));
    const byPreset = new Set(keys(run({ preset: 'recommended' })));
    const byFix = new Set(keys(run({ fix: true })));
    expect(keys(combined)).toEqual(keys(rows).filter((key) => byText.has(key) && byPreset.has(key) && byFix.has(key)));
  });
});
