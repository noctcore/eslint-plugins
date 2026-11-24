/**
 * The advisory replay manifest: published npm vulnerabilities as pinned
 * before and after commits, never the code itself.
 *
 * Every field is validated before anything is fetched or joined to a path:
 * `owner/repo` shape, 40-hex commit SHAs, and file paths that are relative,
 * use `/`, and never climb with `..`. A manifest entry that fails is a hard
 * error, so a typo cannot turn into a request to an unexpected URL or a write
 * outside the cache.
 */
import { readFileSync } from 'node:fs';

/** Why a case is outside what a single-file, syntactic rule can see. */
export const SCOPE_REASONS = {
  'cross-file': 'the untrusted value reaches the sink through code in another file of the package',
  'dependency-sink': 'the dangerous call happens inside a dependency; the touched file only passes the value on',
  'template-engine': 'the flaw is in template compilation or output escaping, not in a call the rules model',
  'sanitizer-logic': 'the flaw is a bypass of a validator or sanitizer written in the file; there is no unguarded sink to report',
} as const;

export type ScopeReason = keyof typeof SCOPE_REASONS;

export type ReplayCwe = 'CWE-78' | 'CWE-22' | 'CWE-918' | 'CWE-601' | 'CWE-79';

export const REPLAY_CWES: readonly ReplayCwe[] = ['CWE-78', 'CWE-22', 'CWE-918', 'CWE-601', 'CWE-79'];

export interface ManifestFile {
  /** Path in the repository, relative, with `/`; the same at both commits. */
  readonly path: string;
  /**
   * Optional 1-based inclusive line ranges in the vulnerable file. When given,
   * only a report starting inside one of them counts on the before side.
   */
  readonly lines?: readonly (readonly [number, number])[];
}

export interface ManifestEntry {
  /** The GitHub advisory id, `GHSA-xxxx-xxxx-xxxx`. */
  readonly id: string;
  readonly package: string;
  /** `owner/repo` on GitHub. */
  readonly repo: string;
  readonly cwe: ReplayCwe;
  /** The fix commit's parent: the code as published while vulnerable. */
  readonly vulnerableCommit: string;
  readonly fixCommit: string;
  readonly files: readonly ManifestFile[];
  /**
   * `in` or `out`. Set by hand after reading the fix, never by the runner, and
   * never from the lint result: an `out` case still runs and is reported, it
   * only leaves the detection and false-alarm rates.
   */
  readonly scope: 'in' | 'out';
  readonly scopeReason?: ScopeReason;
  /**
   * The category rules that model this advisory's sink, when not all of them
   * do (a DOM `innerHTML` write is not a server response). Set by hand.
   */
  readonly rules?: readonly string[];
  /** One sentence on the call and the flow, required for every case. */
  readonly note: string;
}

/** A candidate read and left out: the fix is not a fix of the CWE's flaw, or duplicates another entry. */
export interface ExcludedAdvisory {
  readonly id: string;
  readonly reason: string;
}

export interface Manifest {
  readonly entries: readonly ManifestEntry[];
  readonly excluded: readonly ExcludedAdvisory[];
}

export class ManifestError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The replay manifest has ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ManifestError';
  }
}

const GHSA = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/u;
const SHA = /^[0-9a-f]{40}$/u;
// GitHub owner names: alphanumerics and single hyphens; repo names add `.` and `_`.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/u;
// One path segment: no separators, no control characters, nothing a URL or shell treats specially.
const SEGMENT = /^[A-Za-z0-9._@+-]+$/u;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const SOURCE_EXTENSION = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u;

export function isAdvisoryId(value: string): boolean {
  return GHSA.test(value);
}

export function isCommitSha(value: string): boolean {
  return SHA.test(value);
}

/** Whether `owner/repo` is a well-formed GitHub repository name. */
export function isRepo(value: string): boolean {
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner = '', name = ''] = parts;
  return OWNER.test(owner) && REPO_NAME.test(name) && name !== '.' && name !== '..';
}

/** Whether a path is safe to put in a URL and join under a directory: relative, `/`-separated, no `..`. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 300) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '.' && segment !== '..' && SEGMENT.test(segment));
}

function validateEntry(raw: unknown, index: number, problems: string[]): ManifestEntry | null {
  const where = `entries[${index}]`;
  if (typeof raw !== 'object' || raw === null) {
    problems.push(`${where}: must be an object`);
    return null;
  }
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : '';
  const label = id === '' ? where : `${where} (${id})`;
  const before = problems.length;
  const text = (key: string): string => (typeof value[key] === 'string' ? (value[key] as string) : '');
  if (!GHSA.test(id)) problems.push(`${label}: "id" must be a GHSA id`);
  if (!PACKAGE.test(text('package'))) problems.push(`${label}: "package" must be an npm package name`);
  if (!isRepo(text('repo'))) problems.push(`${label}: "repo" must be owner/repo`);
  if (!REPLAY_CWES.includes(text('cwe') as ReplayCwe)) problems.push(`${label}: "cwe" must be one of ${REPLAY_CWES.join(', ')}`);
  for (const key of ['vulnerableCommit', 'fixCommit']) {
    if (!SHA.test(text(key))) problems.push(`${label}: "${key}" must be a full 40-character lowercase SHA`);
  }
  if (text('vulnerableCommit') === text('fixCommit')) problems.push(`${label}: the vulnerable and fix commits are the same`);
  if (text('note').trim() === '') problems.push(`${label}: "note" must say what the call and the flow are`);
  const scope = text('scope');
  if (scope !== 'in' && scope !== 'out') problems.push(`${label}: "scope" must be "in" or "out" (set by hand after reading the fix)`);
  const reason = value.scopeReason;
  if (scope === 'out' && !(typeof reason === 'string' && reason in SCOPE_REASONS)) {
    problems.push(`${label}: an out-of-scope case needs "scopeReason", one of ${Object.keys(SCOPE_REASONS).join(', ')}`);
  }
  if (scope === 'in' && reason !== undefined) problems.push(`${label}: an in-scope case must not carry "scopeReason"`);

  const rules = value.rules;
  if (rules !== undefined && !(Array.isArray(rules) && rules.length > 0 && rules.every((r) => typeof r === 'string' && /^security\/[a-z0-9-]+$/u.test(r)))) {
    problems.push(`${label}: "rules" must be a non-empty list of security/<rule> ids`);
  }
  const files: ManifestFile[] = [];
  if (!Array.isArray(value.files) || value.files.length === 0) {
    problems.push(`${label}: "files" must list at least one file`);
  } else {
    const seen = new Set<string>();
    for (const [i, file] of (value.files as unknown[]).entries()) {
      const f = (typeof file === 'object' && file !== null ? file : {}) as Record<string, unknown>;
      const path = typeof f.path === 'string' ? f.path : '';
      if (!isSafeRelativePath(path)) {
        problems.push(`${label}: files[${i}].path "${path}" must be relative, use /, and contain no . or .. segment`);
        continue;
      }
      if (!SOURCE_EXTENSION.test(path)) problems.push(`${label}: files[${i}].path "${path}" is not JavaScript or TypeScript`);
      if (seen.has(path)) problems.push(`${label}: files[${i}].path "${path}" is listed twice`);
      seen.add(path);
      const lines = f.lines;
      if (lines !== undefined) {
        const ok =
          Array.isArray(lines) &&
          lines.every(
            (range) =>
              Array.isArray(range) &&
              range.length === 2 &&
              Number.isInteger(range[0]) &&
              Number.isInteger(range[1]) &&
              (range[0] as number) >= 1 &&
              (range[0] as number) <= (range[1] as number),
          );
        if (!ok) problems.push(`${label}: files[${i}].lines must be [[from, to], ...] with 1 <= from <= to`);
      }
      files.push({ path, ...(lines === undefined ? {} : { lines: lines as [number, number][] }) });
    }
  }
  if (problems.length > before) return null;
  return {
    id,
    package: text('package'),
    repo: text('repo'),
    cwe: text('cwe') as ReplayCwe,
    vulnerableCommit: text('vulnerableCommit'),
    fixCommit: text('fixCommit'),
    files,
    scope: scope as 'in' | 'out',
    ...(scope === 'out' ? { scopeReason: reason as ScopeReason } : {}),
    ...(rules === undefined ? {} : { rules: rules as string[] }),
    note: text('note'),
  };
}

/** Validates a parsed manifest and throws a {@link ManifestError} listing every problem at once. */
export function parseManifest(raw: unknown): Manifest {
  const problems: string[] = [];
  const list = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list)) throw new ManifestError(['the manifest must be { "entries": [...] }']);
  const entries: ManifestEntry[] = [];
  const ids = new Set<string>();
  for (const [index, item] of list.entries()) {
    const entry = validateEntry(item, index, problems);
    if (entry === null) continue;
    if (ids.has(entry.id)) problems.push(`entries[${index}] (${entry.id}): listed twice`);
    ids.add(entry.id);
    entries.push(entry);
  }
  const excluded: ExcludedAdvisory[] = [];
  const rawExcluded = (raw as { excluded?: unknown }).excluded ?? [];
  if (!Array.isArray(rawExcluded)) problems.push('"excluded" must be a list');
  else {
    for (const [index, item] of rawExcluded.entries()) {
      const value = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id : '';
      const reason = typeof value.reason === 'string' ? value.reason : '';
      if (!GHSA.test(id) || reason.trim() === '') problems.push(`excluded[${index}]: needs a GHSA "id" and a "reason"`);
      else if (ids.has(id)) problems.push(`excluded[${index}] (${id}): also listed as an entry`);
      else excluded.push({ id, reason });
    }
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return { entries, excluded };
}

export function readManifest(path: string): Manifest {
  return parseManifest(JSON.parse(readFileSync(path, 'utf8')));
}
