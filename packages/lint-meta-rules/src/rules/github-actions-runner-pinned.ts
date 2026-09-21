import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment } from './shared';

/**
 * Options for {@link createGithubActionsRunnerPinnedRule}.
 *
 * Ported from a private monorepo that hardcoded the `*-latest` label shape and read a
 * pre-collected `workflowFiles` list; both are now options.
 */
export interface GithubActionsRunnerPinnedOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** A runner label matching this is floating. Default `/^[\w.-]+-latest$/u`. */
  readonly floatingLabel?: RegExp;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-runner-pinned';

const RUNS_ON = /^(\s*)runs-on:\s*(.*)$/u;
const DEFAULT_FLOATING_LABEL = /^[\w.-]+-latest$/u;

/*
 * Reads `runs-on:` as a scalar, a flow list (`[a, b]`) or a block list / `labels:` mapping. An
 * expression (`${{ matrix.os }}`) cannot be judged from the text and is left alone.
 */
function runnerLabels(lines: readonly string[], start: number, indent: number): string[] {
  const inline = stripYamlComment(RUNS_ON.exec(lines[start] ?? '')?.[2] ?? '').trim();
  const collected = [inline];

  if (inline === '') {
    for (const line of lines.slice(start + 1)) {
      const text = stripYamlComment(line);
      if (text.trim() === '') {
        continue;
      }
      if ((/^\s*/u.exec(text)?.[0].length ?? 0) <= indent) {
        break;
      }
      collected.push(text.replace(/^\s*(?:-\s+|labels:\s*)/u, ''));
    }
  }

  return collected
    .filter((value) => !value.includes('${{'))
    .flatMap((value) => value.split(/[\s,[\]'"]+/u))
    .filter((label) => label !== '');
}

/**
 * Check one workflow's text. `ubuntu-latest` is repointed by GitHub to a new OS
 * image on its own schedule, so a green workflow can turn red (or quietly change
 * what it tests) with no commit. Pinning a named image (`ubuntu-24.04`) makes the
 * move a reviewed diff.
 */
export function checkWorkflowRunnersPinned(
  file: string,
  text: string,
  floatingLabel: RegExp = DEFAULT_FLOATING_LABEL,
): IViolation[] {
  const violations: IViolation[] = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const match = RUNS_ON.exec(line);
    if (match === null || line.trimStart().startsWith('#')) {
      return;
    }

    for (const label of runnerLabels(lines, index, match[1]?.length ?? 0)) {
      if (floatingLabel.test(label)) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `line ${index + 1}: \`runs-on\` uses the floating runner label "${label}". Pin a named image (for example \`ubuntu-24.04\`) so a runner image change is a reviewed diff.`,
          line: index + 1,
        });
      }
    }
  });

  return violations;
}

/** No workflow job may run on a floating (`*-latest`) runner label. */
export function createGithubActionsRunnerPinnedRule(
  options: GithubActionsRunnerPinnedOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const floatingLabel = options.floatingLabel ?? DEFAULT_FLOATING_LABEL;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions jobs must run on a pinned runner image (for example ubuntu-24.04), never a *-latest label.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowRunnersPinned(file, ctx.read(file) ?? '', floatingLabel),
      );
    },
  };
}
