/**
 * `bun run bench:replay` replays published npm advisories: the vulnerable
 * code must be reported, the fixed code must not.
 *
 *   bun run bench:replay                 fetch, lint in a container, report, compare with the baseline
 *   bun run bench:replay --check         also exit 1 on a regression or a stale baseline (the nightly job)
 *   bun run bench:replay --update        rewrite bench/advisories/baseline.json; refuses to record a regression
 *   bun run bench:replay --update --allow-regressions   record one on purpose
 *   bun run bench:replay fetch           only fetch the pinned files into the cache
 *   bun run bench:replay collect --cwe CWE-78 --limit 10    print candidate manifest entries
 *
 * The lint step runs in a container with no network, a read-only root, the
 * repository and the fetched sources mounted read-only, and one writable
 * output directory. `lint` is that container's entry point and refuses to run
 * anywhere else. Nothing fetched is installed, imported or executed: ESLint
 * parses it as text.
 *
 * Run `bun run build` first: the security plugin is imported from its dist/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCorpus } from '../corpus';
import { loadPlugin } from '../score';
import { collect } from './collect';
import { fetchManifest } from './fetch';
import { ManifestError, readManifest, REPLAY_CWES, type ReplayCwe } from './manifest';
import {
  buildReplayBaseline,
  compareReplay,
  renderReplayMarkdown,
  summarize,
  type ReplayBaseline,
} from './report';
import { replayManifest, type ReplayResult } from './score';

const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = resolve(BENCH_DIR, '..');
const MANIFEST = join(BENCH_DIR, 'advisories', 'manifest.json');
const BASELINE = join(BENCH_DIR, 'advisories', 'baseline.json');
const CACHE = join(BENCH_DIR, 'out', 'replay-cache');
const OUT = join(BENCH_DIR, 'out', 'replay');
const RESULTS = 'results.json';

/** oven/bun at the repo's Bun version, pinned by digest. */
const IMAGE = 'oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895';
const IN_CONTAINER = 'BENCH_REPLAY_CONTAINER';
const CONTAINER_SOURCES = '/replay/sources';
const CONTAINER_OUT = '/replay/out';

interface Flags {
  readonly command: 'run' | 'fetch' | 'lint' | 'collect';
  readonly check: boolean;
  readonly update: boolean;
  readonly allowRegressions: boolean;
  readonly values: ReadonlyMap<string, string>;
}

function parseFlags(argv: readonly string[]): Flags {
  const [first, ...rest] = argv;
  const commands = ['fetch', 'lint', 'collect'] as const;
  const command = commands.find((c) => c === first) ?? 'run';
  const args = command === 'run' ? argv : rest;
  const values = new Map<string, string>();
  const valued = new Set(['--cwe', '--limit', '--sources', '--out']);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (valued.has(arg) && args[i + 1] !== undefined) values.set(arg, args[++i] ?? '');
    else if (!['--check', '--update', '--allow-regressions'].includes(arg)) unknown.push(arg);
  }
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')}`);
  return {
    command,
    check: args.includes('--check'),
    update: args.includes('--update'),
    allowRegressions: args.includes('--allow-regressions'),
    values,
  };
}

function env(name: string): string | undefined {
  // eslint-disable-next-line noctcore-contracts/no-direct-process-env -- a CLI reads its switches directly
  return process.env[name];
}

function pluginVersion(): string {
  const manifest = join(REPO_ROOT, 'packages', 'eslint-plugin-security', 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** Lints every entry from the sources directory and writes the raw results. Container only. */
async function lint(sources: string, out: string): Promise<number> {
  if (env(IN_CONTAINER) !== '1') {
    console.error('`lint` is the replay container entry point; run `bun run bench:replay` instead.');
    return 1;
  }
  const manifest = readManifest(MANIFEST);
  const corpus = loadCorpus(join(BENCH_DIR, 'corpus'), ['security']);
  const plugin = await loadPlugin('security');
  const results = replayManifest(manifest.entries, corpus.categories, plugin, sources, REPO_ROOT);
  writeFileSync(join(out, RESULTS), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Linted ${results.length} advisories.`);
  return 0;
}

/** Runs `lint` in a locked-down container: no network, read-only everything but the output. */
function lintInContainer(): number {
  mkdirSync(OUT, { recursive: true });
  const user = typeof process.getuid === 'function' && typeof process.getgid === 'function' ? [`--user`, `${process.getuid()}:${process.getgid()}`] : [];
  const args = [
    'run', '--rm',
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '256',
    '--memory', '2g',
    ...user,
    '--env', `${IN_CONTAINER}=1`,
    '--env', 'HOME=/tmp',
    '--env', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH=0',
    '--env', 'NO_COLOR=1',
    // The repository at its own path, so the workspace's relative symlinks resolve.
    '--volume', `${REPO_ROOT}:${REPO_ROOT}:ro`,
    '--volume', `${CACHE}:${CONTAINER_SOURCES}:ro`,
    '--volume', `${OUT}:${CONTAINER_OUT}:rw`,
    '--workdir', REPO_ROOT,
    IMAGE,
    'bun', join(BENCH_DIR, 'src', 'replay', 'cli.ts'), 'lint', '--sources', CONTAINER_SOURCES, '--out', CONTAINER_OUT,
  ];
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    console.error(`docker could not start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** Fetches every pinned file into the cache and lists what could not be fetched. */
async function fetchAll(): Promise<number> {
  mkdirSync(CACHE, { recursive: true });
  const failures = await fetchManifest(readManifest(MANIFEST), CACHE);
  for (const f of failures) console.error(`  not fetched: ${f.id} ${f.side} ${f.path}: ${f.reason}`);
  return failures.length;
}

function readBaseline(): ReplayBaseline | null {
  return existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as ReplayBaseline) : null;
}

async function run(flags: Flags): Promise<number> {
  await fetchAll();
  const status = lintInContainer();
  if (status !== 0) return status;

  const results = JSON.parse(readFileSync(join(OUT, RESULTS), 'utf8')) as ReplayResult[];
  const committed = readBaseline();
  const comparison = compareReplay(committed, results);
  const summary = summarize(results);
  const version = pluginVersion();
  const markdown = renderReplayMarkdown(results, summary, comparison, version);
  writeFileSync(join(OUT, 'report.md'), markdown);
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify({ pluginVersion: version, summary, comparison, results }, null, 2)}\n`);
  console.log(markdown);
  console.log(`Wrote ${join('bench', 'out', 'replay', 'report.md')} and report.json.`);
  const stepSummary = env('GITHUB_STEP_SUMMARY');
  if (stepSummary !== undefined && stepSummary !== '') writeFileSync(stepSummary, markdown, { flag: 'a' });

  if (flags.update) {
    if (comparison.regressions.length > 0 && !flags.allowRegressions) {
      console.error(
        [
          `Refusing to update: ${comparison.regressions.length} outcome(s) got worse.`,
          ...comparison.regressions.map((c) => `  regression ${c.id} ${c.side}: ${c.from ?? 'n/a'} -> ${c.to ?? 'n/a'}`),
          'Fix the rule, or pass --allow-regressions to record them on purpose.',
        ].join('\n'),
      );
      return 1;
    }
    writeFileSync(BASELINE, `${JSON.stringify(buildReplayBaseline('@noctcore/eslint-plugin-security', results, committed), null, 2)}\n`);
    console.log(`Updated ${join('bench', 'advisories', 'baseline.json')}.`);
    return 0;
  }
  if (comparison.regressions.length > 0) {
    console.error(`Replay ratchet failed: ${comparison.regressions.length} outcome(s) got worse than bench/advisories/baseline.json.`);
    return flags.check ? 1 : 0;
  }
  if (!comparison.upToDate) {
    console.error('bench/advisories/baseline.json is out of date (no regressions). Run `bun run bench:replay --update`.');
    return flags.check ? 1 : 0;
  }
  console.log('Replay ratchet: no regressions, baseline up to date.');
  return 0;
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.command === 'lint') {
    return lint(flags.values.get('--sources') ?? CONTAINER_SOURCES, flags.values.get('--out') ?? CONTAINER_OUT);
  }
  if (flags.command === 'fetch') {
    const failed = await fetchAll();
    console.log(`Fetched into ${join('bench', 'out', 'replay-cache')}; ${failed} file(s) failed.`);
    return 0;
  }
  if (flags.command === 'collect') {
    const cwe = flags.values.get('--cwe') as ReplayCwe | undefined;
    if (cwe === undefined || !REPLAY_CWES.includes(cwe)) throw new Error(`--cwe must be one of ${REPLAY_CWES.join(', ')}`);
    const limit = Number(flags.values.get('--limit') ?? '10');
    const manifest = existsSync(MANIFEST) ? readManifest(MANIFEST) : { entries: [], excluded: [] };
    const known = new Set([...manifest.entries, ...manifest.excluded].map((e) => e.id));
    console.log(JSON.stringify(await collect(cwe, limit, known), null, 2));
    return 0;
  }
  return run(flags);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof ManifestError ? error.message : error);
  process.exitCode = 1;
}
