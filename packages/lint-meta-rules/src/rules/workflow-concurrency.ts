/*
 * A textual reader for the `concurrency:` keys of a GitHub Actions workflow and
 * the `cancel-in-progress` entry under each. Line based, not a YAML parse, like
 * the other workflow rules in this package. The caller passes comment-stripped lines.
 */
import { unquote } from './shared';

const KEY = /^(\s*)("[^"]+"|'[^']+'|[\w.-]+):(.*)$/u;
const CONCURRENCY = /^(\s*)concurrency:(.*)$/u;
const CANCEL_IN_PROGRESS = /^cancel-in-progress:(.*)$/u;
const FLOW_CANCEL_IN_PROGRESS = /(?:^|[{,])\s*["']?cancel-in-progress["']?\s*:\s*([^,}]*)/u;

/** One `concurrency:` key: `index` is the 0-based line, `job` is `null` at workflow level. */
export interface ConcurrencyKey {
  readonly index: number;
  readonly indent: number;
  /** The trimmed text after `concurrency:`. */
  readonly value: string;
  readonly job: string | null;
}

/** A `cancel-in-progress` entry: its 0-based line and the raw text after the colon. */
export interface CancelInProgressEntry {
  readonly index: number;
  readonly raw: string;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/*
 * The workflow-level `concurrency:` key (column 0) and the job-level ones (at the column of a job's
 * own keys). A key deeper than that belongs to a step or a nested structure and is not read.
 */
export function concurrencyKeys(lines: readonly string[]): ConcurrencyKey[] {
  const keys: ConcurrencyKey[] = [];
  const jobsStart = lines.findIndex((line) => /^jobs:\s*$/u.test(line));

  lines.forEach((line, index) => {
    const match = CONCURRENCY.exec(line);
    if (match?.[1] === '') {
      keys.push({ index, indent: 0, value: (match[2] ?? '').trim(), job: null });
    }
  });
  if (jobsStart === -1) return keys;

  let jobIndent = -1;
  let keyIndent = -1;
  let job: string | null = null;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (jobIndent === -1) jobIndent = indent;

    if (indent === jobIndent) {
      const match = KEY.exec(line);
      job = match === null ? null : unquote(match[2] ?? '');
      keyIndent = -1;
      continue;
    }
    if (job === null || indent < jobIndent) continue;
    if (keyIndent === -1) keyIndent = indent;
    if (indent !== keyIndent) continue;
    const match = CONCURRENCY.exec(line);
    if (match !== null) keys.push({ index, indent, value: (match[2] ?? '').trim(), job });
  }
  return keys;
}

/** Whether the key holds a mapping, block (`concurrency:` then children) or flow (`{ ... }`). */
export function isConcurrencyMapping(key: ConcurrencyKey): boolean {
  return key.value === '' || key.value.startsWith('{');
}

/** The first `cancel-in-progress` entry of a mapping `key`, whatever its value, or `null`. */
export function cancelInProgressEntry(
  lines: readonly string[],
  key: ConcurrencyKey,
): CancelInProgressEntry | null {
  if (key.value.startsWith('{')) {
    const raw = FLOW_CANCEL_IN_PROGRESS.exec(key.value)?.[1];
    return raw === undefined ? null : { index: key.index, raw };
  }
  if (key.value !== '') return null;

  let childIndent = -1;
  for (let index = key.index + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    if (indent <= key.indent) break;
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) continue;
    const raw = CANCEL_IN_PROGRESS.exec(line.trim())?.[1];
    if (raw !== undefined) return { index, raw };
  }
  return null;
}
