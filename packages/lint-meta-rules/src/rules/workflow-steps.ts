/*
 * A textual reader for the steps of a GitHub Actions workflow: every item of
 * every `steps:` list, and the keys written on each step, plus each job's
 * effective `permissions:`. Line based, not a YAML parse, like the other
 * workflow rules in this package.
 */

import { stripYamlComment, unquote } from './shared';

/** One item of a `steps:` list, as 0-based line indexes `[start, end)`. */
export interface WorkflowStep {
  readonly start: number;
  readonly end: number;
  /** The step's `name:`, or where it starts when it has none. */
  readonly label: string;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/** Every step of every `steps:` list in the workflow. */
export function workflowSteps(lines: readonly string[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  lines.forEach((line, stepsIndex) => {
    if (!/^\s*steps:\s*$/u.test(line)) return;
    const listIndent = indentOf(line);
    let itemIndent = -1;
    let start = -1;
    const close = (end: number): void => {
      if (start === -1) return;
      const name = lines
        .slice(start, end)
        .map((candidate) => /^\s*(?:-\s+)?name:\s*(.+?)\s*$/u.exec(candidate)?.[1])
        .find((candidate) => candidate !== undefined);
      steps.push({ start, end, label: name ?? `the step on line ${String(start + 1)}` });
    };
    let end = stepsIndex + 1;
    for (let index = stepsIndex + 1; index < lines.length; index += 1) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || current.trimStart().startsWith('#')) continue;
      const indent = indentOf(current);
      const isItem = /^\s*-(?:\s|$)/u.test(current);
      // A sequence may sit at its key's own indent; anything else that shallow ends the list.
      if (indent < listIndent || (indent === listIndent && !isItem)) break;
      if (itemIndent === -1 && isItem) itemIndent = indent;
      if (isItem && indent === itemIndent) {
        close(index);
        start = index;
      }
      end = index + 1;
    }
    close(end);
  });
  return steps;
}

/** The column a step's own keys start at: just past the `- ` of its first line. */
function stepKeyColumn(lines: readonly string[], step: WorkflowStep): number {
  const first = lines[step.start] ?? '';
  return /^(\s*-\s+)/u.exec(first)?.[1]?.length ?? indentOf(first) + 2;
}

/**
 * The keys written on a step, each with its value lines: the inline value, or
 * the lines nested under the key (a `with:` mapping, a `run: |` block).
 */
export function stepKeys(lines: readonly string[], step: WorkflowStep): Map<string, readonly string[]> {
  const keyColumn = stepKeyColumn(lines, step);
  const keys = new Map<string, string[]>();
  let open: string[] | null = null;
  for (let index = step.start; index < step.end; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const indent = index === step.start ? keyColumn : indentOf(line);
    const text = index === step.start ? line.slice(keyColumn) : line.trimStart();
    if (indent > keyColumn) {
      open?.push(text.trimEnd());
      continue;
    }
    const key = /^([\w-]+):\s*(.*?)\s*$/u.exec(text);
    open = null;
    if (indent !== keyColumn || key === null) continue;
    const value = key[2] ?? '';
    // A block scalar header (`|`, `>-`, `|2+`) or nothing: the value is the lines under it.
    open = value === '' || /^[|>][+-]?\d*[+-]?$/u.test(value) ? [] : null;
    keys.set(key[1] ?? '', open ?? [value]);
  }
  return keys;
}

/** A `permissions:` value: a `read-all`/`write-all` shorthand, a scope map, or a form the reader does not parse. */
export type WorkflowPermissions =
  | { readonly kind: 'all'; readonly level: 'read' | 'write' }
  | { readonly kind: 'scopes'; readonly scopes: ReadonlyMap<string, string> }
  | { readonly kind: 'unknown'; readonly raw: string };

/** One job under `jobs:`, as 0-based line indexes `[start, end)`, with the permissions its token gets. */
export interface JobPermissions {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** The job-level block when present, else the workflow-level one, else `null`. Never a merge of both. */
  readonly permissions: WorkflowPermissions | null;
  /** Where `permissions` came from. */
  readonly source: 'job' | 'workflow' | null;
  /** The workflow-level block, whatever the job declares, or `null` when there is none. */
  readonly workflow: WorkflowPermissions | null;
}

const JOB_KEY = /^(\s*)(['"]?)([\w.-]+)\2\s*:/u;
const PERMISSIONS_KEY = /^permissions:\s*(.*?)\s*$/u;
const SCOPE_ENTRY = /^\s*(['"]?)([\w-]+)\1\s*:\s*(['"]?)([\w-]+)\3\s*$/u;

function isContent(line: string): boolean {
  return line.trim() !== '' && !line.trimStart().startsWith('#');
}

function readScopeEntry(text: string, scopes: Map<string, string>): void {
  const entry = SCOPE_ENTRY.exec(text);
  if (entry !== null) scopes.set(entry[2] ?? '', entry[4] ?? '');
}

function readPermissions(
  lines: readonly string[],
  index: number,
  keyIndent: number,
  value: string,
): WorkflowPermissions {
  const scalar = unquote(value);
  if (scalar === 'read-all' || scalar === 'write-all') {
    return { kind: 'all', level: scalar === 'read-all' ? 'read' : 'write' };
  }
  const scopes = new Map<string, string>();
  if (value.startsWith('{')) {
    if (!value.includes('}')) return { kind: 'unknown', raw: value };
    const inside = value.slice(1, value.indexOf('}'));
    for (const pair of inside.split(',')) readScopeEntry(pair, scopes);
    return { kind: 'scopes', scopes };
  }
  if (value !== '') return { kind: 'unknown', raw: value };
  let childIndent = -1;
  for (let next = index + 1; next < lines.length; next += 1) {
    const line = lines[next] ?? '';
    if (!isContent(line)) continue;
    const indent = indentOf(line);
    if (indent <= keyIndent) break;
    if (childIndent === -1) childIndent = indent;
    if (indent === childIndent) readScopeEntry(line, scopes);
  }
  return { kind: 'scopes', scopes };
}

/** Every job under the top-level `jobs:` key, with its effective `permissions:`. */
export function workflowJobPermissions(lines: readonly string[]): JobPermissions[] {
  const text = lines.map(stripYamlComment);
  const jobsStart = text.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (jobsStart === -1) return [];

  let workflow: WorkflowPermissions | null = null;
  for (const [index, line] of text.entries()) {
    const match = PERMISSIONS_KEY.exec(line);
    if (match !== null) workflow = readPermissions(text, index, 0, match[1] ?? '');
  }

  const jobs: { name: string; start: number; end: number; own: WorkflowPermissions | null }[] = [];
  let jobIndent = -1;
  let keyIndent = -1;
  let end = text.length;
  for (let index = jobsStart + 1; index < text.length; index += 1) {
    const line = text[index] ?? '';
    if (!isContent(line)) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      end = index;
      break;
    }
    if (jobIndent === -1) jobIndent = indent;
    if (indent === jobIndent) {
      const match = JOB_KEY.exec(line);
      const previous = jobs.at(-1);
      if (previous !== undefined) previous.end = index;
      if (match === null) {
        keyIndent = -1;
        continue;
      }
      jobs.push({ name: match[3] ?? '', start: index, end: text.length, own: null });
      keyIndent = -1;
      continue;
    }
    const job = jobs.at(-1);
    if (job === undefined || indent < jobIndent) continue;
    if (keyIndent === -1) keyIndent = indent;
    if (indent !== keyIndent) continue;
    const match = /^\s*permissions:\s*(.*?)\s*$/u.exec(line);
    if (match !== null) job.own = readPermissions(text, index, keyIndent, match[1] ?? '');
  }
  return jobs.map((job) => {
    const last = job.end === text.length ? end : job.end;
    const inherited = job.own === null;
    const permissions = job.own ?? workflow;
    return {
      name: job.name,
      start: job.start,
      end: last,
      permissions,
      source: permissions === null ? null : inherited ? 'workflow' : 'job',
      workflow,
    };
  });
}
