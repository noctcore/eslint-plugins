import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment, unquote } from './shared';

/**
 * Options for {@link createGithubActionsTimeoutRequiredRule}.
 *
 * Ported from a private monorepo whose rule read a pre-collected workflow list
 * and assumed two-space indentation; the globs are now an option and any
 * consistent indentation is read.
 */
export interface GithubActionsTimeoutRequiredOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-timeout-required';

const KEY = /^(\s*)("[^"]+"|'[^']+'|[\w.-]+):(.*)$/u;
/** A positive whole number of minutes, or an expression GitHub resolves at run time. */
const TIMEOUT_VALUE = /^(?:[1-9]\d*(?:\.\d+)?|\$\{\{.*\}\})$/u;

interface Job {
  readonly name: string;
  readonly line: number;
  /** The job's own keys (one level below the job name), each with its scalar value. */
  readonly keys: Map<string, string>;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/** The jobs under the top-level `jobs:` key, each with its direct keys. */
export function workflowJobs(text: string): Job[] {
  const lines = text.split('\n').map(stripYamlComment);
  const start = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (start === -1) return [];

  const jobs: { name: string; line: number; keys: Map<string, string> }[] = [];
  let jobIndent = -1;
  let keyIndent = -1;
  let current: (typeof jobs)[number] | null = null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    if (jobIndent === -1) jobIndent = indent;

    const match = KEY.exec(line);
    if (indent === jobIndent) {
      current = match === null ? null : { name: unquote(match[2] ?? ''), line: index + 1, keys: new Map() };
      if (current !== null) jobs.push(current);
      keyIndent = -1;
      continue;
    }
    if (current === null || indent < jobIndent) continue;
    if (keyIndent === -1) keyIndent = indent;
    if (indent === keyIndent && match !== null) {
      current.keys.set(unquote(match[2] ?? ''), unquote(match[3] ?? ''));
    }
  }
  return jobs;
}

/** Check one workflow's text. */
export function checkWorkflowTimeouts(file: string, text: string): IViolation[] {
  const violations: IViolation[] = [];
  for (const job of workflowJobs(text)) {
    // A reusable-workflow call (`uses:` on the job) cannot set `timeout-minutes`;
    // the called workflow's own jobs carry it.
    if (job.keys.has('uses')) continue;
    const timeout = job.keys.get('timeout-minutes');
    if (timeout !== undefined && TIMEOUT_VALUE.test(timeout)) continue;
    violations.push({
      file,
      rule: RULE_ID,
      line: job.line,
      message:
        timeout === undefined
          ? `line ${String(job.line)}: job "${job.name}" has no job-level \`timeout-minutes\`. A hung step runs for GitHub's 6 hour default, holding the check and the runner. Set a timeout a little above the job's slowest green run.`
          : `line ${String(job.line)}: job "${job.name}" sets \`timeout-minutes: ${timeout}\`, which is not a positive number of minutes.`,
    });
  }
  return violations;
}

/** Every workflow job that runs steps must declare a job-level `timeout-minutes`. */
export function createGithubActionsTimeoutRequiredRule(
  options: GithubActionsTimeoutRequiredOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions jobs must declare a job-level timeout-minutes (reusable-workflow calls are exempt).',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowTimeouts(file, ctx.read(file) ?? ''),
      );
    },
  };
}
