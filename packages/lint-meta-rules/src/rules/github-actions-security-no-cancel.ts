import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, baseName, globFiles, stripYamlComment, unquote } from './shared';
import { cancelInProgressEntry, concurrencyKeys, type ConcurrencyKey } from './workflow-concurrency';

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

function isYamlTrue(raw: string): boolean {
  return /^(?:true|True|TRUE)$/u.test(unquote(raw));
}

/** The 0-based line of a literal-true `cancel-in-progress` under `key`, or `null`. */
function cancelInProgressTrue(lines: readonly string[], key: ConcurrencyKey): number | null {
  const entry = cancelInProgressEntry(lines, key);
  return entry !== null && isYamlTrue(entry.raw) ? entry.index : null;
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
