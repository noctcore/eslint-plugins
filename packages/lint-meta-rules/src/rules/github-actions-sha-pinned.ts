import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles } from './shared';

/**
 * Options for {@link createGithubActionsShaPinnedRule}.
 *
 * Ported from a private monorepo whose runner handed the rule a pre-collected
 * `workflowFiles` list; that list is now the `workflowGlobs` option.
 */
export interface GithubActionsShaPinnedOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-sha-pinned';

const USES_LINE = /^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)['"]?\s*(#.*)?$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/u;
const VERSION_COMMENT = /^#\s*v\d/u;

/**
 * Check one workflow's text. A `uses:` ref that is a tag or a branch is a
 * moving target: whoever controls the action's repo can repoint it, and the new
 * code then runs with the workflow's token. A full commit SHA cannot move. The
 * trailing `# vN` comment keeps the pin readable and is what Dependabot rewrites
 * on a bump, so a SHA with no version comment is rejected too.
 *
 * Local actions (`./path`) are exempt. A `docker://` ref must carry a digest.
 */
export function checkWorkflowActionsPinned(file: string, text: string): IViolation[] {
  const violations: IViolation[] = [];

  text.split('\n').forEach((line, index) => {
    const match = USES_LINE.exec(line);
    const ref = match?.[1];
    if (ref === undefined || ref.startsWith('./')) {
      return;
    }

    const where = `line ${index + 1}`;
    const report = (message: string): void => {
      violations.push({ file, rule: RULE_ID, message, line: index + 1 });
    };

    if (ref.startsWith('docker://')) {
      if (!DOCKER_DIGEST.test(ref)) {
        report(`${where}: \`uses: ${ref}\` is not pinned by digest. Append \`@sha256:<digest>\`.`);
      }
      return;
    }

    const at = ref.lastIndexOf('@');
    const pin = at === -1 ? '' : ref.slice(at + 1);

    if (!FULL_SHA.test(pin)) {
      report(
        `${where}: \`uses: ${ref}\` is not pinned to a 40-character commit SHA. Resolve the tag to its commit and write \`uses: ${at === -1 ? ref : ref.slice(0, at)}@<sha> # vN\`.`,
      );
      return;
    }

    if (!VERSION_COMMENT.test(match?.[2] ?? '')) {
      report(
        `${where}: \`uses: ${ref}\` is SHA-pinned but has no \`# vN\` comment. Keep the version beside the SHA so the pin stays readable and Dependabot can bump it.`,
      );
    }
  });

  return violations;
}

/** Every workflow `uses:` ref must be a full commit SHA with a `# vN` comment. */
export function createGithubActionsShaPinnedRule(
  options: GithubActionsShaPinnedOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions `uses:` refs must be pinned to a 40-character commit SHA with a `# vN` comment (local ./ actions exempt).',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowActionsPinned(file, ctx.read(file) ?? ''),
      );
    },
  };
}
