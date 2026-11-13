import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment, unquote } from './shared';
import { stepKeys, workflowJobPermissions, workflowSteps, type JobPermissions } from './workflow-steps';

/** Options for {@link createGithubActionsPathsFilterPermissionsRule}. */
export interface GithubActionsPathsFilterPermissionsOptions {
  /** Actions that call the pull request files API, matched on the name before `@`, case-insensitively. Default `['dorny/paths-filter']`. */
  readonly filterActions?: readonly string[];
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-paths-filter-permissions';
const DEFAULT_FILTER_ACTIONS = ['dorny/paths-filter'] as const;

function actionName(uses: string): string {
  return unquote(stripYamlComment(uses)).split('@')[0]?.trim().toLowerCase() ?? '';
}

function grantsPullRequests(permissions: JobPermissions['permissions']): boolean {
  if (permissions === null) return false;
  if (permissions.kind === 'all') return true;
  if (permissions.kind === 'unknown') return true;
  const level = permissions.scopes.get('pull-requests');
  return level === 'read' || level === 'write';
}

function reason(job: JobPermissions): string {
  const { permissions, source, workflow } = job;
  if (permissions === null) {
    return 'neither the workflow nor the job declares `permissions:`, so the job gets the repository default token, which on a restricted default (typical for private repositories) lacks `pull-requests`';
  }
  if (source === 'job' && grantsPullRequests(workflow)) {
    return 'the job-level `permissions:` replaces the workflow-level block, it does not add to it';
  }
  if (permissions.kind === 'scopes') {
    if (permissions.scopes.size === 0) return 'the `permissions:` block is empty, which grants no scope';
    const level = permissions.scopes.get('pull-requests');
    return level === undefined
      ? 'the `permissions:` block does not list `pull-requests`, so it is `none`'
      : `\`pull-requests\` is \`${level}\``;
  }
  return 'the `permissions:` block does not grant `pull-requests`';
}

/** Check one workflow's text: every job that runs a filter action has `pull-requests` at read or write. */
export function checkWorkflowPathsFilterPermissions(
  file: string,
  text: string,
  filterActions: readonly string[],
): IViolation[] {
  const lines = text.split('\n');
  const wanted = new Set(filterActions.map(actionName));
  const steps = workflowSteps(lines);
  const violations: IViolation[] = [];
  for (const job of workflowJobPermissions(lines)) {
    if (grantsPullRequests(job.permissions)) continue;
    const match = steps
      .filter((step) => step.start >= job.start && step.start < job.end)
      .map((step) => ({ step, uses: stepKeys(lines, step).get('uses')?.[0] ?? '' }))
      .find(({ uses }) => wanted.has(actionName(uses)));
    if (match === undefined) continue;
    const line = match.step.start + 1;
    const used = unquote(stripYamlComment(match.uses));
    violations.push({
      file,
      rule: RULE_ID,
      line,
      message: `line ${String(line)}: job "${job.name}" runs ${used} but its token has no \`pull-requests: read\`: ${reason(job)}. Add \`pull-requests: read\` to the job's \`permissions:\`.`,
    });
  }
  return violations;
}

/** A job that runs a paths-filter action has an effective `pull-requests: read` grant. */
export function createGithubActionsPathsFilterPermissionsRule(
  options: GithubActionsPathsFilterPermissionsOptions = {},
): IMetaRule {
  const filterActions = options.filterActions ?? DEFAULT_FILTER_ACTIONS;
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'A job that runs a paths-filter action must have an effective `pull-requests: read` grant; a job-level `permissions:` block replaces the workflow-level one.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowPathsFilterPermissions(file, ctx.read(file) ?? '', filterActions),
      );
    },
  };
}
