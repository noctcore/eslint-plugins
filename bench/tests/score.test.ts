import { describe, expect, it } from 'vitest';

import { buildBaseline, compareBaseline, serializeBaseline } from '../src/baseline';
import { loadCorpus } from '../src/corpus';
import { scoreOf, signedPercent } from '../src/metrics';
import { renderSarif } from '../src/report';
import { loadPlugin, scoreCategories, type CaseResult, type LoadedPlugin } from '../src/score';
import { header, SHELL_CATEGORY, writeCorpus } from './helpers';

// Runs under both ESLint legs of `bun run test`, so the scorer's use of
// `Linter` is exercised on ESLint 9.0.0 as well as on 10.
async function scoreDemo(files: Record<string, string>) {
  const root = writeCorpus({ 'security/demo/category.json': SHELL_CATEGORY, ...files });
  const corpus = loadCorpus(root);
  const plugins = new Map<string, LoadedPlugin>([['security', await loadPlugin('security')]]);
  const run = scoreCategories(corpus.categories, plugins, root);
  return { corpus, plugins, run, baseline: buildBaseline(run.results, run.reports, corpus.categories, plugins) };
}

const CAUGHT = {
  'security/demo/caught.vuln.js.case': `${header('caught')}\nimport { exec } from 'node:child_process';\nexec(\`ls \${req.query.dir}\`); // expect: security/no-shell-interpolation\n`,
  'security/demo/caught.safe.js.case': `${header('caught')}\n// ok\nimport { execFile } from 'node:child_process';\nexecFile('ls', [req.query.dir]);\n`,
};
const MISSED = {
  // The command is built in a variable, which a single-call rule cannot see.
  'security/demo/missed.vuln.js.case': `${header('missed')}\nimport { exec } from 'node:child_process';\nconst cmd = 'ls ' + req.query.dir;\nexec(cmd); // expect: security/no-shell-interpolation\n`,
  // Validated, then interpolated: safe, but the rule still reports it.
  'security/demo/missed.safe.js.case': `${header('missed')}\n// ok\nimport { exec } from 'node:child_process';\nconst dir = req.query.dir;\nif (/^[a-z]+$/.test(dir)) exec(\`ls \${dir}\`);\n`,
};

function outcomes(results: readonly CaseResult[]): Record<string, string> {
  return Object.fromEntries(results.map((r) => [r.id, r.outcome]));
}

describe('scoring', () => {
  it('classifies every label and every safe twin', async () => {
    const { run } = await scoreDemo({ ...CAUGHT, ...MISSED });
    expect(outcomes(run.results)).toEqual({
      'security/demo/caught.safe.js.case#security/no-shell-interpolation': 'TN',
      'security/demo/caught.vuln.js.case#security/no-shell-interpolation': 'TP',
      'security/demo/missed.safe.js.case#security/no-shell-interpolation': 'FP',
      'security/demo/missed.vuln.js.case#security/no-shell-interpolation': 'FN',
    });
    expect(run.reports.map((r) => r.role).sort()).toEqual(['FP', 'TP']);
  });

  it('counts a report on an unlabelled line as an extra, not a TP', async () => {
    const { run } = await scoreDemo({
      'security/demo/two.vuln.js.case': `${header('two')}\nimport { exec } from 'node:child_process';\nexec(\`a \${x}\`);\nexec(\`b \${y}\`); // expect: security/no-shell-interpolation\n`,
      'security/demo/two.safe.js.case': `${header('two')}\n// ok\n`,
    });
    expect(outcomes(run.results)['security/demo/two.vuln.js.case#security/no-shell-interpolation']).toBe('TP');
    expect(run.reports.map((r) => [r.line, r.role])).toEqual([
      [3, 'extra'],
      [4, 'TP'],
    ]);
    const { baseline } = await scoreDemo({
      'security/demo/two.vuln.js.case': `${header('two')}\nimport { exec } from 'node:child_process';\nexec(\`a \${x}\`);\nexec(\`b \${y}\`); // expect: security/no-shell-interpolation\n`,
      'security/demo/two.safe.js.case': `${header('two')}\n// ok\n`,
    });
    expect(baseline.rules['security/no-shell-interpolation']?.extra).toBe(1);
    expect(baseline.categories['security/demo']?.extra).toBe(1);
  });

  it('matches a report only when it starts on the labelled line', async () => {
    const { run } = await scoreDemo({
      'security/demo/span.vuln.js.case': `${header('span')}\nimport { exec } from 'node:child_process';\nexec(\`a \${\n  x\n}\`); // expect: security/no-shell-interpolation\n`,
      'security/demo/span.safe.js.case': `${header('span')}\n// ok\n`,
    });
    // The report starts on line 3 and covers line 5, where the label is: not a match.
    expect(outcomes(run.results)['security/demo/span.vuln.js.case#security/no-shell-interpolation']).toBe('FN');
  });

  it('charges a measured rule for firing on another category\'s safe code', async () => {
    const root = writeCorpus({
      'security/demo/category.json': SHELL_CATEGORY,
      ...CAUGHT,
      'security/other/category.json': JSON.stringify({
        title: 'Other',
        cwe: null,
        rules: ['security/require-sanitized-html'],
        overrides: { 'security/require-sanitized-html': 'error' },
      }),
      'security/other/x.vuln.js.case': `// @bench category=other framework=node pair=x title="t"\nel.innerHTML = input; // expect: security/require-sanitized-html\n`,
      'security/other/x.safe.js.case': `// @bench category=other framework=node pair=x title="t"\n// ok\nimport { exec } from 'node:child_process';\nexec(\`ls \${dir}\`);\n`,
    });
    const corpus = loadCorpus(root);
    const plugins = new Map<string, LoadedPlugin>([['security', await loadPlugin('security')]]);
    const run = scoreCategories(corpus.categories, plugins, root);
    const results = outcomes(run.results);
    // The shell rule is in recommended, so it runs on the other category too.
    expect(results['security/other/x.safe.js.case#security/no-shell-interpolation']).toBe('FP');
    expect(results['security/other/x.safe.js.case#security/require-sanitized-html']).toBe('TN');
    // The opt-in HTML rule does not run on the demo category, so it gets no negative there.
    expect(results['security/demo/caught.safe.js.case#security/require-sanitized-html']).toBeUndefined();
    const baseline = buildBaseline(run.results, run.reports, corpus.categories, plugins);
    expect(baseline.rules['security/no-shell-interpolation']).toMatchObject({ fp: 0, tn: 1, crossFp: 1, crossSafe: 1 });
    // The category row scores only its own rules.
    expect(baseline.categories['security/other']).toMatchObject({ tp: 1, fp: 0, tn: 1 });
  });

  it('computes detection, false alarms and Youden\'s J', () => {
    const result = (outcome: CaseResult['outcome']): CaseResult => ({
      id: outcome,
      category: 'c',
      rule: 'r',
      outcome,
      file: 'f',
      line: null,
      pair: 'p',
      framework: 'node',
      cwe: null,
      title: '',
    });
    const score = scoreOf(['TP', 'TP', 'TP', 'FN', 'FP', 'TN', 'TN', 'TN'].map((o) => result(o as CaseResult['outcome'])));
    expect(score).toEqual({ tp: 3, fn: 1, fp: 1, tn: 3, detection: 0.75, falseAlarm: 0.25, j: 0.5 });
    expect(scoreOf([result('TN')])).toMatchObject({ detection: null, falseAlarm: 0, j: null });
    expect(signedPercent(0.5)).toBe('+50%');
    expect(signedPercent(-0.07)).toBe('-7%');
  });

  it('writes valid SARIF tagged with the bench role', async () => {
    const { run, baseline } = await scoreDemo(CAUGHT);
    const sarif = JSON.parse(renderSarif(baseline, run.reports)) as {
      version: string;
      runs: { results: { ruleId: string; properties: { benchRole: string } }[] }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results).toMatchObject([
      { ruleId: 'noctcore-security/no-shell-interpolation', properties: { benchRole: 'TP' } },
    ]);
  });
});

describe('ratchet', () => {
  it('passes on an identical tree and reports the file as up to date', async () => {
    const { baseline } = await scoreDemo({ ...CAUGHT, ...MISSED });
    const committed = JSON.parse(serializeBaseline(baseline));
    expect(compareBaseline(committed, baseline)).toMatchObject({
      regressions: [],
      improvements: [],
      added: [],
      removed: [],
      upToDate: true,
    });
  });

  it('flags TP -> FN and TN -> FP as regressions, and the reverse as improvements', async () => {
    const { baseline } = await scoreDemo({ ...CAUGHT, ...MISSED });
    const flip = { TP: 'FN', FN: 'TP', TN: 'FP', FP: 'TN' } as const;
    const committed = JSON.parse(serializeBaseline(baseline));
    for (const entry of Object.values(committed.cases) as { outcome: keyof typeof flip }[]) {
      entry.outcome = flip[entry.outcome];
    }
    const comparison = compareBaseline(committed, baseline);
    // The committed file said caught.* were FN/FP and missed.* were TP/TN; now
    // caught.* improved and missed.* regressed.
    expect(comparison.regressions.map((c) => [c.id.split('#')[0], c.from, c.to])).toEqual([
      ['security/demo/missed.safe.js.case', 'TN', 'FP'],
      ['security/demo/missed.vuln.js.case', 'TP', 'FN'],
    ]);
    expect(comparison.improvements).toHaveLength(2);
    expect(comparison.upToDate).toBe(false);
  });

  it('marks a removed TP or TN case as removed protection, and a removed gap as a plain removal', async () => {
    const before = await scoreDemo({ ...CAUGHT, ...MISSED });
    const after = await scoreDemo(MISSED);
    const comparison = compareBaseline(JSON.parse(serializeBaseline(before.baseline)), after.baseline);
    expect(comparison.removed.map((c) => c.from).sort()).toEqual(['TN', 'TP']);
    expect(comparison.removedProtection).toHaveLength(2);
    const gapsGone = compareBaseline(JSON.parse(serializeBaseline(before.baseline)), (await scoreDemo(CAUGHT)).baseline);
    expect(gapsGone.removed.map((c) => c.from).sort()).toEqual(['FN', 'FP']);
    expect(gapsGone.removedProtection).toEqual([]);
  });

  it('treats a new case as a recorded gap to add, not a regression', async () => {
    const before = await scoreDemo(CAUGHT);
    const after = await scoreDemo({ ...CAUGHT, ...MISSED });
    const comparison = compareBaseline(JSON.parse(serializeBaseline(before.baseline)), after.baseline);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.added.map((c) => c.to).sort()).toEqual(['FN', 'FP']);
    expect(comparison.upToDate).toBe(false);
  });
});
