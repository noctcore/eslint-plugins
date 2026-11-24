import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { loadCorpus } from '../src/corpus';
import { loadPlugin } from '../src/score';
import { fixCommitOf, sourceFiles } from '../src/replay/collect';
import { cachePath, rawUrl } from '../src/replay/fetch';
import { nearTouched, touchedLines } from '../src/replay/locate';
import { isRepo, isSafeRelativePath, ManifestError, parseManifest, readManifest, type ManifestEntry } from '../src/replay/manifest';
import { buildReplayBaseline, compareReplay, renderReplayMarkdown, summarize } from '../src/replay/report';
import { categoryForCwe, replayEntry, type ReplayResult } from '../src/replay/score';
import { header, SHELL_CATEGORY, writeCorpus } from './helpers';

const BEFORE = 'a'.repeat(40);
const AFTER = 'b'.repeat(40);

function entry(overrides: Partial<Record<keyof ManifestEntry, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'GHSA-2222-3333-4444',
    package: 'demo',
    repo: 'owner/demo',
    cwe: 'CWE-78',
    vulnerableCommit: BEFORE,
    fixCommit: AFTER,
    files: [{ path: 'lib/run.js' }],
    scope: 'in',
    note: 'lib/run.js interpolates the name into exec.',
    ...overrides,
  };
}

function problemsOf(raw: unknown): readonly string[] {
  try {
    parseManifest(raw);
    return [];
  } catch (error) {
    return (error as ManifestError).problems;
  }
}

describe('manifest validation', () => {
  it('accepts a well-formed entry', () => {
    expect(parseManifest({ entries: [entry()] }).entries).toHaveLength(1);
  });

  it.each([
    ['repo', '../demo'],
    ['repo', 'owner/demo/extra'],
    ['repo', 'owner/..'],
    ['vulnerableCommit', 'abc123'],
    ['fixCommit', 'B'.repeat(40)],
    ['id', 'CVE-2024-0001'],
    ['cwe', 'CWE-89'],
    ['scope', 'maybe'],
    ['note', ''],
  ])('rejects %s = %j', (key, value) => {
    expect(problemsOf({ entries: [entry({ [key]: value })] }).length).toBeGreaterThan(0);
  });

  it.each(['../etc/passwd', '/etc/passwd', 'lib/../../x.js', 'lib\\run.js', 'lib/./run.js', 'lib//run.js', 'README.md', 'lib/run.js?x=1'])(
    'rejects the file path %j',
    (path) => {
      expect(problemsOf({ entries: [entry({ files: [{ path }] })] }).length).toBeGreaterThan(0);
    },
  );

  it('needs a reason for an out-of-scope case, and none for an in-scope one', () => {
    expect(problemsOf({ entries: [entry({ scope: 'out' })] })).toEqual([
      expect.stringContaining('needs "scopeReason"'),
    ]);
    expect(problemsOf({ entries: [entry({ scope: 'out', scopeReason: 'cross-file' })] })).toEqual([]);
    expect(problemsOf({ entries: [entry({ scopeReason: 'cross-file' })] })).toEqual([
      expect.stringContaining('must not carry "scopeReason"'),
    ]);
  });

  it('rejects duplicates and an excluded id that is also an entry', () => {
    expect(problemsOf({ entries: [entry(), entry()] })).toEqual([expect.stringContaining('listed twice')]);
    expect(problemsOf({ entries: [entry()], excluded: [{ id: 'GHSA-2222-3333-4444', reason: 'dup' }] })).toEqual([
      expect.stringContaining('also listed as an entry'),
    ]);
  });

  it('validates the committed manifest: at least 50 advisories across the five CWEs', () => {
    const manifest = readManifest(join(import.meta.dirname, '..', 'advisories', 'manifest.json'));
    expect(manifest.entries.length).toBeGreaterThanOrEqual(50);
    expect(new Set(manifest.entries.map((e) => e.cwe))).toEqual(new Set(['CWE-78', 'CWE-22', 'CWE-918', 'CWE-601', 'CWE-79']));
  });

  it('shapes repos and paths', () => {
    expect(isRepo('sveltejs/kit')).toBe(true);
    expect(isRepo('-bad/kit')).toBe(false);
    expect(isSafeRelativePath('packages/@scope/a+b/src/x.ts')).toBe(true);
    expect(isSafeRelativePath('a/b%2F..%2Fc.js')).toBe(false);
  });
});

describe('fetch', () => {
  it('builds the raw URL only from validated parts, on the raw host', () => {
    const url = rawUrl('owner/demo', BEFORE, 'packages/@scope/x.ts');
    expect(url.href).toBe(`https://raw.githubusercontent.com/owner/demo/${BEFORE}/packages/%40scope/x.ts`);
    expect(() => rawUrl('owner/demo', BEFORE, '../x.js')).toThrow();
    expect(() => rawUrl('evil.com/x/y', BEFORE, 'x.js')).toThrow();
    expect(() => rawUrl('owner/demo', 'main', 'x.js')).toThrow();
  });

  it('keeps cache paths under the root and suffixed', () => {
    const root = join(tmpdir(), 'replay-root');
    expect(cachePath(root, 'GHSA-2222-3333-4444', 'before', 'lib/run.js')).toBe(
      join(root, 'GHSA-2222-3333-4444', 'before', 'lib/run.js.fetched'),
    );
    expect(() => cachePath(root, 'GHSA-2222-3333-4444', 'before', '../run.js')).toThrow();
    expect(() => cachePath(root, '../x', 'before', 'run.js')).toThrow();
  });
});

describe('collect', () => {
  it('takes exactly one linked fix commit', () => {
    const commit = (sha: string): string => `https://github.com/owner/demo/commit/${sha}`;
    expect(fixCommitOf([commit(AFTER), 'https://example.com'])).toEqual({ repo: 'owner/demo', sha: AFTER });
    expect(fixCommitOf([commit(AFTER), commit(BEFORE)])).toBeNull();
    expect(fixCommitOf(['https://github.com/owner/demo/pull/1'])).toBeNull();
  });

  it('keeps modified source files only', () => {
    const files = [
      'lib/run.js',
      'lib/run.test.js',
      'test/run.js',
      'docs/x.js',
      'dist/run.min.js',
      'samples/unit-tests/demo.js',
      'types/index.d.ts',
      'README.md',
    ].map((filename) => ({ filename, status: 'modified' }));
    expect(sourceFiles([...files, { filename: 'lib/new.js', status: 'added' }])).toEqual(['lib/run.js']);
  });
});

describe('locating the fix', () => {
  it('marks changed lines on both sides', () => {
    const touched = touchedLines('a\nb\nc\nd', 'a\nB\nc\nd');
    expect([...touched.before]).toEqual([2]);
    expect([...touched.after]).toEqual([2]);
  });

  it('ties an insertion to the old lines around it', () => {
    const touched = touchedLines('a\nb\nc', 'a\nguard\nb\nc');
    expect([...touched.before].sort()).toEqual([1, 2]);
    expect([...touched.after]).toEqual([2]);
  });

  it('counts a report in the changed function, not in an untouched one', () => {
    const spans = [
      [1, 10],
      [12, 20],
    ] as const;
    const touched = new Set([3]);
    expect(nearTouched(8, spans, touched)).toBe(true);
    expect(nearTouched(15, spans, touched)).toBe(false);
    expect(nearTouched(30, spans, new Set([28]))).toBe(true);
    expect(nearTouched(30, spans, new Set([20]))).toBe(false);
  });
});

/** Writes `files` (`{ 'GHSA-.../before/lib/run.js': '...' }`) as a fetch cache. */
function writeCache(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'noctcore-replay-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, `${path}.fetched`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

async function replay(files: Record<string, string>, raw: Record<string, unknown> = entry()): Promise<ReplayResult> {
  const corpusRoot = writeCorpus({
    'security/demo/category.json': SHELL_CATEGORY,
    'security/demo/x.vuln.js.case': `${header('x')}\nexec(\`ls \${a}\`); // expect: security/no-shell-interpolation\n`,
    'security/demo/x.safe.js.case': `${header('x')}\n// ok\nexecFile('ls', [a]);\n`,
  });
  const categories = loadCorpus(corpusRoot).categories;
  const [parsed] = parseManifest({ entries: [raw] }).entries;
  if (parsed === undefined) throw new Error('no entry');
  const plugin = await loadPlugin('security');
  return replayEntry(parsed, categoryForCwe(categories, 'CWE-78'), plugin, writeCache(files), new Linter({ cwd: corpusRoot }), corpusRoot);
}

const UNRELATED = "function other() {\n  exec(`echo ${process.argv[2]}`);\n}\n";

describe('replaying an advisory', () => {
  it('detects the vulnerable code, stays quiet on the fix, and ignores untouched sinks', async () => {
    const before = `import { exec } from 'node:child_process';\nexport function run(name) {\n  exec(\`ls \${name}\`);\n}\n${UNRELATED}`;
    const after = `import { execFile } from 'node:child_process';\nexport function run(name) {\n  execFile('ls', [name]);\n}\n${UNRELATED}`;
    const result = await replay({
      'GHSA-2222-3333-4444/before/lib/run.js': before,
      'GHSA-2222-3333-4444/after/lib/run.js': after,
    });
    expect(result.rules['security/no-shell-interpolation']).toEqual({ before: 'TP', after: 'TN' });
    expect(result.reports.filter((r) => !r.related)).toHaveLength(2);
  });

  it('charges a report that survives the fix in the changed function', async () => {
    const before = `export function run(name) {\n  exec(\`ls \${name}\`);\n}\n`;
    // A guard in a helper the rule cannot read: the fix is real, the report stays.
    const after = `export function run(name) {\n  assertPlainName(name);\n  exec(\`ls \${name}\`);\n}\n`;
    const result = await replay({
      'GHSA-2222-3333-4444/before/lib/run.js': before,
      'GHSA-2222-3333-4444/after/lib/run.js': after,
    });
    expect(result.rules['security/no-shell-interpolation']).toEqual({ before: 'TP', after: 'FP' });
  });

  it('ignores the fetched code\'s own eslint-disable comments', async () => {
    const before = `/* eslint-disable */\nexport function run(name) {\n  exec(\`ls \${name}\`);\n}\n`;
    const after = `/* eslint-disable */\nexport function run(name) {\n  execFile('ls', [name]);\n}\n`;
    const result = await replay({
      'GHSA-2222-3333-4444/before/lib/run.js': before,
      'GHSA-2222-3333-4444/after/lib/run.js': after,
    });
    expect(result.rules['security/no-shell-interpolation']).toEqual({ before: 'TP', after: 'TN' });
  });

  it('leaves an advisory without an outcome when a file is missing or does not parse', async () => {
    const missing = await replay({ 'GHSA-2222-3333-4444/before/lib/run.js': 'exec(`ls ${a}`);\n' });
    expect(missing.rules['security/no-shell-interpolation']).toEqual({ before: null, after: null });
    expect(missing.problems).toEqual([expect.objectContaining({ side: 'after', kind: 'unavailable' })]);
    const broken = await replay({
      'GHSA-2222-3333-4444/before/lib/run.js': 'exec(`ls ${a}`);\n',
      'GHSA-2222-3333-4444/after/lib/run.js': 'function (\n',
    });
    expect(broken.rules['security/no-shell-interpolation']).toEqual({ before: null, after: null });
    expect(broken.problems).toEqual([expect.objectContaining({ side: 'after', kind: 'unparsed' })]);
  });
});

describe('the replay report and baseline', () => {
  const result = (id: string, before: 'TP' | 'FN' | null, after: 'FP' | 'TN' | null, scope: 'in' | 'out' = 'in'): ReplayResult => ({
    id,
    package: 'demo',
    repo: 'owner/demo',
    cwe: 'CWE-78',
    category: 'security/command-injection',
    scope,
    scopeReason: scope === 'out' ? 'cross-file' : null,
    note: 'a note.',
    files: ['lib/run.js'],
    rules: { 'security/no-shell-interpolation': { before, after } },
    reports: [],
    problems: [],
  });

  it('rates in-scope advisories and counts out-of-scope ones apart', () => {
    const summary = summarize([result('GHSA-a', 'TP', 'TN'), result('GHSA-b', 'FN', 'FP'), result('GHSA-c', 'TP', 'FP', 'out'), result('GHSA-d', null, null)]);
    expect(summary.total).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1, detection: 0.5, falseAlarm: 0.5, outOfScope: 1, outOfScopeDetected: 1, unavailable: 1 });
    expect(summary.outOfScope).toEqual({ 'cross-file': 1 });
    expect(renderReplayMarkdown([result('GHSA-a', 'TP', 'TN')], summarize([result('GHSA-a', 'TP', 'TN')]), null, '1.0.0')).toContain('| CWE-78 | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 100% | 0% | +100% | 0 / 0 |');
  });

  it('flags regressions, keeps a side it could not lint, and reports staleness', () => {
    const committed = buildReplayBaseline('p', [result('GHSA-a', 'TP', 'TN'), result('GHSA-b', 'FN', 'TN')], null);
    const now = [result('GHSA-a', 'FN', null), result('GHSA-b', 'TP', 'TN'), result('GHSA-c', 'FN', 'TN')];
    const comparison = compareReplay(committed, now);
    expect(comparison.regressions).toEqual([{ id: 'GHSA-a#security/no-shell-interpolation', side: 'before', from: 'TP', to: 'FN' }]);
    expect(comparison.unavailable).toEqual([{ id: 'GHSA-a#security/no-shell-interpolation', side: 'after', from: 'TN', to: null }]);
    expect(comparison.improvements).toHaveLength(1);
    expect(comparison.added).toEqual(['GHSA-c#security/no-shell-interpolation']);
    expect(comparison.upToDate).toBe(false);
    const updated = buildReplayBaseline('p', now, committed);
    expect(updated.outcomes['GHSA-a#security/no-shell-interpolation']).toEqual({ before: 'FN', after: 'TN' });
    expect(compareReplay(updated, now).upToDate).toBe(true);
  });
});
