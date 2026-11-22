import { describe, expect, test } from 'bun:test';

import { readBenchBaseline, renderBenchPage, type BenchBaseline } from './bench';

const score = { tp: 1, fn: 1, fp: 1, tn: 1, detection: 0.5, falseAlarm: 0.5, j: 0 };

const SAMPLE: BenchBaseline = {
  plugins: { security: { package: '@noctcore/eslint-plugin-security', rules: ['measured-rule', 'unmeasured-rule'] } },
  rules: { 'security/measured-rule': { ...score, enabledBy: 'recommended' } },
  categories: { 'security/demo': { ...score, title: 'Demo', cwe: 'CWE-78', pairs: 2, rules: ['security/measured-rule'] } },
  cases: {
    a: { outcome: 'TP', rule: 'security/measured-rule', file: 'security/demo/a.vuln.js', framework: 'express', title: 'caught | piped <b>' },
    b: { outcome: 'FN', rule: 'security/measured-rule', file: 'security/demo/b.vuln.ts', framework: 'koa', title: 'missed' },
    c: { outcome: 'FP', rule: 'security/measured-rule', file: 'security/demo/b.safe.ts', framework: 'koa', title: 'false alarm' },
    d: { outcome: 'TN', rule: 'security/measured-rule', file: 'security/demo/a.safe.js', framework: 'express', title: 'quiet' },
  },
};

describe('the benchmark page', () => {
  const page = renderBenchPage(SAMPLE);

  test('has a row per exported rule, measured or not', () => {
    expect(page).toContain('| [`noctcore-security/measured-rule`](/eslint-plugins/rules/security/measured-rule/) | recommended | 1 | 1 | 1 | 1 | 50% | 50% | **0%** |');
    expect(page).toContain('| [`noctcore-security/unmeasured-rule`](/eslint-plugins/rules/security/unmeasured-rule/) | | | | | | no cases yet | | |');
  });

  test('lists what each rule catches, misses and wrongly reports, never the quiet safe cases', () => {
    expect(page).toContain('**Catches** (1)');
    expect(page).toContain('**Misses** (1)');
    expect(page).toContain('**Wrongly reports (safe code)** (1)');
    expect(page).toContain('/bench/corpus/security/demo/b.vuln.ts');
    expect(page).not.toContain('quiet');
  });

  test('escapes titles so they cannot break the Markdown', () => {
    expect(page).toContain('caught \\| piped \\<b\\>');
  });

  test('renders the committed baseline', () => {
    const real = renderBenchPage(readBenchBaseline());
    expect(real).toContain('## security');
    expect(real).toContain('noctcore-security/no-shell-interpolation');
  });
});
