/**
 * Proposes manifest entries from the GitHub Advisory Database. It never
 * writes the manifest: it prints candidates, and a person reads each fix and
 * sets `scope` (and `scopeReason`) before adding it. A candidate without a
 * scope fails manifest validation on purpose.
 *
 * Selection is mechanical, so the sample is not picked by what the rules
 * catch: reviewed npm advisories for the CWE, newest first, that link exactly
 * one fix commit on GitHub whose commit has one parent and modifies 1 to 5
 * JavaScript or TypeScript source files (tests, docs, examples, fixtures,
 * built, vendored, minified and bundled files do not count).
 *
 * Authenticates with GITHUB_TOKEN or GH_TOKEN when set, else through the
 * GitHub CLI (`gh api`), which keeps its token to itself.
 */
import { spawnSync } from 'node:child_process';

import { isRepo, isSafeRelativePath, type ManifestEntry, type ReplayCwe } from './manifest';

const SOURCE = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/u;
const NOT_SOURCE =
  /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|unit-tests?|samples?|docs?|examples?|fixtures?|__fixtures__|__mocks__|benchmarks?|dist|build|vendor|third_party|coverage)\/|\.(?:test|spec|min|bundle)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/u;
const COMMIT_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{40})(?:[#?].*)?$/u;
const MAX_FILES = 5;

interface Advisory {
  readonly ghsa_id: string;
  readonly withdrawn_at: string | null;
  readonly references: readonly string[];
  readonly vulnerabilities: readonly { readonly package: { readonly ecosystem: string; readonly name: string } }[];
}

interface Commit {
  readonly parents: readonly { readonly sha: string }[];
  readonly files?: readonly { readonly filename: string; readonly status: string }[];
}

export type Candidate = Omit<ManifestEntry, 'scope' | 'scopeReason' | 'note'> & { readonly scope: 'TODO'; readonly note: '' };

function token(): string | null {
  // eslint-disable-next-line noctcore-contracts/no-direct-process-env -- a CLI reads its credentials directly
  const value = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  return value === '' ? null : value;
}

const NEXT_LINK = /<https:\/\/api\.github\.com([^>]+)>;\s*rel="next"/iu;

/** `gh api --include`: the status line and headers, a blank line, then the body. */
function viaCli(path: string): { status: number; link: string; text: string } {
  const result = spawnSync('gh', ['api', '--include', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw new Error(`collect needs GITHUB_TOKEN, GH_TOKEN or the gh CLI: ${result.error.message}`);
  const output = result.stdout.replace(/\r\n/gu, '\n');
  const split = output.indexOf('\n\n');
  const head = split === -1 ? output : output.slice(0, split);
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/u.exec(head)?.[1] ?? '0');
  const link = /^link: (.*)$/imu.exec(head)?.[1] ?? '';
  return { status, link, text: split === -1 ? '' : output.slice(split + 2) };
}

async function api<T>(path: string, auth: string | null): Promise<{ body: T; next: string | null }> {
  let status: number;
  let link: string;
  let text: string;
  if (auth === null) {
    ({ status, link, text } = viaCli(path));
  } else {
    if (!path.startsWith('/')) throw new Error(`not an API path: ${path}`);
    // The host is closed by \`/\` before the path, so a crafted Link header cannot move the request.
    const response = await fetch(`https://api.github.com/${path.slice(1)}`, {
      headers: { authorization: `Bearer ${auth}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    link = response.headers.get('link') ?? '';
    text = await response.text();
  }
  if (status < 200 || status >= 300) throw new Error(`GET ${path}: HTTP ${status}`);
  return { body: JSON.parse(text) as T, next: NEXT_LINK.exec(link)?.[1] ?? null };
}

/** The single fix commit an advisory links, or null when it links none or several. */
export function fixCommitOf(references: readonly string[]): { repo: string; sha: string } | null {
  const commits = new Map<string, { repo: string; sha: string }>();
  for (const reference of references) {
    const match = COMMIT_URL.exec(reference);
    if (match?.[1] !== undefined && match[2] !== undefined) commits.set(match[2], { repo: match[1], sha: match[2] });
  }
  return commits.size === 1 ? ([...commits.values()][0] ?? null) : null;
}

/** The files of a fix that count: modified JavaScript or TypeScript source, nothing generated or test-only. */
export function sourceFiles(files: readonly { readonly filename: string; readonly status: string }[]): string[] {
  return files
    .filter((f) => f.status === 'modified' && SOURCE.test(f.filename) && !NOT_SOURCE.test(f.filename))
    .map((f) => f.filename)
    .filter(isSafeRelativePath);
}

/** Up to `limit` candidates for one CWE, skipping advisory ids in `skip`. */
export async function collect(cwe: ReplayCwe, limit: number, skip: ReadonlySet<string>): Promise<Candidate[]> {
  const auth = token();
  const found: Candidate[] = [];
  let page: string | null = `/advisories?ecosystem=npm&type=reviewed&per_page=100&cwes=${cwe.slice('CWE-'.length)}`;
  while (page !== null && found.length < limit) {
    const { body, next }: { body: Advisory[]; next: string | null } = await api<Advisory[]>(page, auth);
    page = next;
    for (const advisory of body) {
      if (found.length >= limit) break;
      if (advisory.withdrawn_at !== null || skip.has(advisory.ghsa_id)) continue;
      const fix = fixCommitOf(advisory.references);
      const pkg = advisory.vulnerabilities.find((v) => v.package.ecosystem === 'npm')?.package.name;
      if (fix === null || pkg === undefined || !isRepo(fix.repo)) continue;
      let commit: Commit;
      try {
        commit = (await api<Commit>(`/repos/${fix.repo}/commits/${fix.sha}`, auth)).body;
      } catch {
        continue;
      }
      const parent = commit.parents.length === 1 ? commit.parents[0]?.sha : undefined;
      const files = sourceFiles(commit.files ?? []);
      if (parent === undefined || files.length === 0 || files.length > MAX_FILES) continue;
      found.push({
        id: advisory.ghsa_id,
        package: pkg,
        repo: fix.repo,
        cwe,
        vulnerableCommit: parent,
        fixCommit: fix.sha,
        files: files.map((path) => ({ path })),
        scope: 'TODO',
        note: '',
      });
    }
  }
  return found;
}
