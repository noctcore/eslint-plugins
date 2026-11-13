import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, baseName, globFiles, stripYamlComment, unquote } from './shared';

/** Options for {@link createGithubActionsSecurityNoCancelRule}. */
export interface GithubActionsSecurityNoCancelOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /**
   * A workflow whose file base name matches this is a security scan workflow and is checked.
   * Default `/security|sast|secrets|codeql|scan/iu`.
   */
  readonly securityWorkflowPattern?: RegExp;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-security-no-cancel';

const DEFAULT_SECURITY_WORKFLOW_PATTERN = /security|sast|secrets|codeql|scan/iu;

const KEY = /^(\s*)("[^"]+"|'[^']+'|[\w.-]+):(.*)$/u;
const CONCURRENCY = /^(\s*)concurrency:(.*)$/u;
const CANCEL_IN_PROGRESS = /^cancel-in-progress:(.*)$/u;
const FLOW_CANCEL_IN_PROGRESS = /(?:^|[{,])\s*["']?cancel-in-progress["']?\s*:\s*([^,}]*)/u;

interface ConcurrencyKey {
  readonly index: number;
  readonly indent: number;
  readonly value: string;
  readonly job: string | null;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

function isYamlTrue(raw: string): boolean {
  return /^(?:true|True|TRUE)$/u.test(unquote(raw));
}

/*
 * The workflow-level `concurrency:` key (column 0) and the job-level ones (at the column of a job's
 * own keys). A key deeper than that belongs to a step or a nested structure and is not read.
 */
function concurrencyKeys(lines: readonly string[]): ConcurrencyKey[] {
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

/** The 0-based line of a literal-true `cancel-in-progress` under `key`, or `null`. */
function cancelInProgressTrue(lines: readonly string[], key: ConcurrencyKey): number | null {
  if (key.value.startsWith('{')) {
    const raw = FLOW_CANCEL_IN_PROGRESS.exec(key.value)?.[1];
    return raw !== undefined && isYamlTrue(raw) ? key.index : null;
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
    if (raw !== undefined && isYamlTrue(raw)) return index;
  }
  return null;
}

/** Check one security workflow's text. The caller has already matched the file name. */
export function checkWorkflowSecurityNoCancel(file: string, text: string): IViolation[] {
  const lines = text.split('\n').map(stripYamlComment);
  const violations: IViolation[] = [];
  for (const key of concurrencyKeys(lines)) {
    const found = cancelInProgressTrue(lines, key);
    if (found === null) continue;
    const line = found + 1;
    const where = key.job === null ? 'workflow-level `concurrency`' : `\`concurrency\` of job "${key.job}"`;
    violations.push({
      file,
      rule: RULE_ID,
      line,
      message: `line ${String(line)}: ${where} sets \`cancel-in-progress: true\` in a security scan workflow. A newer run cancels the scan part way, so a commit can merge with no finished scan. Set \`cancel-in-progress: false\` or leave it out.`,
    });
  }
  return violations;
}

/** A security scan workflow never sets a literal `cancel-in-progress: true`. */
export function createGithubActionsSecurityNoCancelRule(
  options: GithubActionsSecurityNoCancelOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  const given = options.securityWorkflowPattern ?? DEFAULT_SECURITY_WORKFLOW_PATTERN;
  const pattern = new RegExp(given.source, given.flags.replace(/[gy]/gu, ''));
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'Security scan workflows (file name matching securityWorkflowPattern) never set a literal `cancel-in-progress: true` in a workflow-level or job-level `concurrency`, so a newer run cannot cancel a scan halfway.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs)
        .filter((file) => pattern.test(baseName(file)))
        .flatMap((file) => checkWorkflowSecurityNoCancel(file, ctx.read(file) ?? ''));
    },
  };
}
