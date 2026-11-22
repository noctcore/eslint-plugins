import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Baseline } from '../src/baseline';
import { loadCorpus } from '../src/corpus';

const CORPUS = fileURLToPath(new URL('../corpus/', import.meta.url));
const BASELINE = fileURLToPath(new URL('../baseline.json', import.meta.url));

// The security categories the corpus promises, each with at least this many
// vulnerable and safe pairs (issue #272). Adding a category is fine; dropping
// one, or thinning it below the floor, fails here.
const SECURITY_CATEGORIES = [
  'command-injection',
  'cookie-flags',
  'open-redirect',
  'path-traversal',
  'server-side-xss',
  'ssrf',
];
const MIN_PAIRS = 30;

describe('the committed corpus', () => {
  // Throws a CorpusError listing every malformed case, if any.
  const corpus = loadCorpus(CORPUS);

  it.each(SECURITY_CATEGORIES)('security/%s has at least 30 pairs in several shapes and both languages', (name) => {
    const category = corpus.categories.find((c) => c.id === `security/${name}`);
    expect(category).toBeDefined();
    const cases = category?.cases ?? [];
    expect(new Set(cases.map((c) => c.meta.pair)).size).toBeGreaterThanOrEqual(MIN_PAIRS);
    expect(new Set(cases.map((c) => c.meta.framework))).toEqual(new Set(['express', 'koa', 'nest', 'node']));
    const languages = new Set(cases.map((c) => (/\.tsx?\.case$/u.test(c.file) ? 'ts' : 'js')));
    expect(languages).toEqual(new Set(['js', 'ts']));
  });

  it('has a baseline entry for every category and every case file', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    expect(Object.keys(baseline.categories).sort()).toEqual(corpus.categories.map((c) => c.id).sort());
    const recorded = new Set(Object.values(baseline.cases).map((c) => c.file));
    const files = corpus.categories.flatMap((c) => c.cases.map((testCase) => testCase.file));
    expect(files.filter((file) => !recorded.has(file))).toEqual([]);
  });
});
