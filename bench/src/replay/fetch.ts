/**
 * Fetches the files a manifest names, at the two pinned commits, and nothing
 * else: one raw file per request from raw.githubusercontent.com. No clone, no
 * submodules, no hooks, no install. The bytes are written as `<path>.fetched`
 * so no tool that picks files by extension (the repo's own `eslint .`, code
 * scanners) treats them as source; the replay lints each under its real name.
 *
 * Commits are immutable, so a file already in the cache is not fetched again.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { isAdvisoryId, isCommitSha, isRepo, isSafeRelativePath, type Manifest, type ManifestEntry } from './manifest';

export type Side = 'before' | 'after';

export const SIDES: readonly Side[] = ['before', 'after'];

/** Larger files are bundles or generated code, not what a fix touches by hand. */
const MAX_BYTES = 2 * 1024 * 1024;
const RAW_HOST = 'raw.githubusercontent.com';
const CONCURRENCY = 8;

export interface FetchFailure {
  readonly id: string;
  readonly side: Side;
  readonly path: string;
  readonly reason: string;
}

/**
 * Where a fetched file lives in the cache. Throws on anything that could leave
 * `root`, even though the manifest was already validated: the check sits next
 * to the join it protects.
 */
export function cachePath(root: string, id: string, side: Side, path: string): string {
  if (!isAdvisoryId(id) || !isSafeRelativePath(path)) {
    throw new Error(`refusing an unsafe cache path: ${id} ${path}`);
  }
  const base = resolve(root);
  const target = resolve(base, id, side, `${path}.fetched`);
  if (!target.startsWith(base + sep)) throw new Error(`refusing a cache path outside ${base}: ${target}`);
  return target;
}

/** The raw URL of one file at one commit, built only from validated parts. */
export function rawUrl(repo: string, commit: string, path: string): URL {
  if (!isRepo(repo) || !isCommitSha(commit) || !isSafeRelativePath(path)) {
    throw new Error(`refusing to build a URL from unvalidated parts: ${repo} ${commit} ${path}`);
  }
  const url = new URL(`https://${RAW_HOST}/`);
  url.pathname = `/${[...repo.split('/'), commit, ...path.split('/')].map(encodeURIComponent).join('/')}`;
  return url;
}

async function fetchOne(entry: ManifestEntry, side: Side, path: string, root: string): Promise<FetchFailure | null> {
  const target = cachePath(root, entry.id, side, path);
  if (existsSync(target)) return null;
  const commit = side === 'before' ? entry.vulnerableCommit : entry.fixCommit;
  const url = rawUrl(entry.repo, commit, path);
  const fail = (reason: string): FetchFailure => ({ id: entry.id, side, path, reason });
  let response: Response;
  try {
    // The origin is the fixed raw host; owner, repo, commit and path were validated above.
    // eslint-disable-next-line noctcore-security/no-user-controlled-fetch-url -- rawUrl pins the origin and validates every part
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    return fail((error as Error).message);
  }
  if (new URL(response.url).host !== RAW_HOST) return fail(`redirected off ${RAW_HOST}`);
  if (!response.ok) return fail(`HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return fail(`larger than ${MAX_BYTES} bytes`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail(`larger than ${MAX_BYTES} bytes`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return null;
}

/** Fetches every file of every entry at both commits into `root`; returns what could not be fetched. */
export async function fetchManifest(manifest: Manifest, root: string): Promise<FetchFailure[]> {
  const jobs = manifest.entries.flatMap((entry) =>
    entry.files.flatMap((file) => SIDES.map((side) => () => fetchOne(entry, side, file.path, root))),
  );
  const failures: FetchFailure[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (job === undefined) return;
      const failure = await job();
      if (failure !== null) failures.push(failure);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return failures.sort((a, b) => `${a.id}${a.path}${a.side}`.localeCompare(`${b.id}${b.path}${b.side}`));
}
