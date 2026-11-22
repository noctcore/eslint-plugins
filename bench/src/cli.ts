/**
 * `bun run bench` scores every plugin with a corpus and writes `out/report.md`
 * and `out/bench.sarif`.
 *
 *   bun run bench                      score, print the tables, compare with the baseline
 *   bun run bench --check              also exit 1 on a regression or a stale baseline (CI)
 *   bun run bench --update             rewrite baseline.json; refuses to record a regression
 *   bun run bench --update --allow-regressions   record one on purpose
 *   bun run bench --update --allow-removals      drop TP or TN cases on purpose
 *   bun run bench --plugin security    only the named plugin(s)
 *
 * Run `bun run build` first: plugins are imported from their built dist/.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBaseline, compareBaseline, serializeBaseline, type Baseline } from './baseline';
import { CorpusError, loadCorpus } from './corpus';
import { renderMarkdown, renderSarif } from './report';
import { loadPlugin, scoreCategories, type LoadedPlugin } from './score';

const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(BENCH_DIR, '..');
const CORPUS = join(BENCH_DIR, 'corpus');
const BASELINE = join(BENCH_DIR, 'baseline.json');
const OUT = join(BENCH_DIR, 'out');

interface Flags {
  readonly check: boolean;
  readonly update: boolean;
  readonly allowRegressions: boolean;
  readonly allowRemovals: boolean;
  readonly plugins: readonly string[] | undefined;
}

function parseFlags(argv: readonly string[]): Flags {
  const plugins: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === '--plugin' && argv[i + 1] !== undefined) plugins.push(argv[i + 1] ?? '');
  });
  const known = new Set(['--check', '--update', '--allow-regressions', '--allow-removals', '--plugin', ...plugins]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')}`);
  return {
    check: argv.includes('--check'),
    update: argv.includes('--update'),
    allowRegressions: argv.includes('--allow-regressions'),
    allowRemovals: argv.includes('--allow-removals'),
    plugins: plugins.length > 0 ? plugins : undefined,
  };
}

function readBaseline(): Baseline | null {
  return existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline) : null;
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = loadCorpus(CORPUS, flags.plugins);
  const plugins = new Map<string, LoadedPlugin>();
  for (const short of new Set(corpus.categories.map((c) => c.plugin))) {
    plugins.set(short, await loadPlugin(short));
  }
  const run = scoreCategories(corpus.categories, plugins, REPO_ROOT);
  const current = buildBaseline(run.results, run.reports, corpus.categories, plugins);
  const committed = readBaseline();
  const comparison = compareBaseline(committed, current);

  const markdown = renderMarkdown(current, comparison);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'report.md'), markdown);
  writeFileSync(join(OUT, 'bench.sarif'), renderSarif(current, run.reports));
  console.log(markdown);
  console.log(`Wrote ${join('bench', 'out', 'report.md')} and ${join('bench', 'out', 'bench.sarif')}.`);
  // In a GitHub Actions job, show the same tables on the run's summary page.
  // eslint-disable-next-line noctcore-contracts/no-direct-process-env -- a CLI reads its CI switch directly
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') appendFileSync(summary, markdown);

  // Regressions are always listed in full; the other lists stop at 20 lines.
  const describe = (label: string, changes: typeof comparison.regressions, limit = 20): string[] => [
    ...changes.slice(0, limit).map((c) => `  ${label} ${c.id}: ${c.from ?? 'new'} -> ${c.to ?? 'removed'}`),
    ...(changes.length > limit ? [`  ... and ${changes.length - limit} more ${label} (see bench/out/report.md)`] : []),
  ];

  if (flags.update) {
    if (comparison.regressions.length > 0 && !flags.allowRegressions) {
      console.error(
        [
          `Refusing to update: ${comparison.regressions.length} case(s) got worse.`,
          ...describe('regression', comparison.regressions, Infinity),
          'Fix the rule, or pass --allow-regressions to record them on purpose.',
        ].join('\n'),
      );
      return 1;
    }
    if (comparison.removedProtection.length > 0 && !flags.allowRemovals) {
      console.error(
        [
          `Refusing to update: ${comparison.removedProtection.length} removed case(s) were TP or TN.`,
          ...describe('removed', comparison.removedProtection, Infinity),
          'Deleting a case a rule handles hides what it protects. Pass --allow-removals to drop them on purpose.',
        ].join('\n'),
      );
      return 1;
    }
    for (const line of describe('removed', comparison.removed, Infinity)) console.log(line);
    writeFileSync(BASELINE, serializeBaseline(current));
    console.log(`Updated ${join('bench', 'baseline.json')}.`);
    return 0;
  }

  if (comparison.regressions.length > 0) {
    console.error(
      [
        `Ratchet failed: ${comparison.regressions.length} case(s) got worse than bench/baseline.json.`,
        ...describe('regression', comparison.regressions, Infinity),
      ].join('\n'),
    );
    return flags.check ? 1 : 0;
  }
  if (!comparison.upToDate) {
    console.error(
      [
        'bench/baseline.json is out of date (no regressions).',
        ...describe('improved', comparison.improvements),
        ...describe('added', comparison.added),
        ...describe('removed', comparison.removed),
        'Run `bun run bench --update` and commit bench/baseline.json.',
      ].join('\n'),
    );
    return flags.check ? 1 : 0;
  }
  console.log('Ratchet: no regressions, baseline up to date.');
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof CorpusError ? error.message : error);
  process.exitCode = 1;
}
