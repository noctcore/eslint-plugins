import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin from '../src/index';
import formatSarif, { addTaxonomyTags, taxonomyTags } from '../src/sarif';

type Docs = { cwe?: readonly string[]; owasp?: readonly string[] };
type RuleWithDocs = { meta: { docs: Docs } };

const rules = Object.entries(plugin.rules as Record<string, RuleWithDocs>);

describe('rule taxonomy', () => {
  it.each(rules)('%s names at least one CWE as CWE-<n>', (_id, rule) => {
    const cwe = rule.meta.docs.cwe ?? [];
    expect(cwe.length).toBeGreaterThan(0);
    for (const id of cwe) {
      expect(id).toMatch(/^CWE-\d+$/u);
    }
  });

  it.each(rules)('%s names its OWASP Top 10 category as A<nn>:2021', (_id, rule) => {
    const owasp = rule.meta.docs.owasp ?? [];
    expect(owasp.length).toBeGreaterThan(0);
    for (const id of owasp) {
      expect(id).toMatch(/^A\d{2}:2021$/u);
    }
  });
});

describe('taxonomyTags', () => {
  it('pads CWE numbers to three digits the way code scanning tags them', () => {
    expect(taxonomyTags({ cwe: ['CWE-78', 'CWE-1004'], owasp: ['A03:2021'] })).toEqual([
      'security',
      'external/cwe/cwe-078',
      'external/cwe/cwe-1004',
      'external/owasp/a03:2021',
    ]);
  });

  it('returns nothing for docs without ids', () => {
    expect(taxonomyTags({ description: 'x' })).toEqual([]);
    expect(taxonomyTags(undefined)).toEqual([]);
  });
});

describe('addTaxonomyTags', () => {
  it('keeps the tags a rule already has and adds each tag once', () => {
    const log = {
      runs: [
        {
          tool: {
            driver: {
              rules: [
                { id: 'a/x', properties: { tags: ['security', 'custom'] } },
                { id: 'b/y', properties: { category: 'none' } },
              ],
            },
          },
        },
      ],
    };
    addTaxonomyTags(log, { 'a/x': { docs: { cwe: ['CWE-22'] } }, 'b/y': { docs: {} } });
    expect(log.runs[0]?.tool.driver.rules).toEqual([
      { id: 'a/x', properties: { tags: ['security', 'custom', 'external/cwe/cwe-022'] } },
      { id: 'b/y', properties: { category: 'none' } },
    ]);
  });
});

describe('formatSarif', () => {
  it('writes the CWE of a reported rule into the SARIF rule tags', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          plugins: { 'noctcore-security': plugin },
          rules: { 'noctcore-security/no-shell-interpolation': 'error' },
        },
      ],
    });
    const results = await eslint.lintText('exec(`git checkout ${branch}`);', {
      filePath: 'src/run.js',
    });
    const output = await formatSarif(results, {
      cwd: process.cwd(),
      rulesMeta: eslint.getRulesMetaForResults(results),
    });
    const log = JSON.parse(output) as {
      runs: { tool: { driver: { rules: { id: string; properties: { tags: string[] } }[] } } }[];
    };
    const rule = log.runs[0]?.tool.driver.rules[0];
    expect(rule?.id).toBe('noctcore-security/no-shell-interpolation');
    expect(rule?.properties.tags).toEqual([
      'security',
      'external/cwe/cwe-078',
      'external/owasp/a03:2021',
    ]);
  });
});
