import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment } from './shared';
import { cancelInProgressEntry, concurrencyKeys, isConcurrencyMapping } from './workflow-concurrency';

/** Options for {@link createGithubActionsConcurrencyExplicitRule}. */
export interface GithubActionsConcurrencyExplicitOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Also report the string form (`concurrency: group-name`), which cannot state `cancel-in-progress`. Default `false`. */
  readonly requireMappingForm?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-concurrency-explicit';

/** Check one workflow's text for `concurrency` keys that leave `cancel-in-progress` unstated. */
export function checkWorkflowConcurrencyExplicit(
  file: string,
  text: string,
  requireMappingForm: boolean,
): IViolation[] {
  const lines = text.split('\n').map(stripYamlComment);
  const violations: IViolation[] = [];
  for (const key of concurrencyKeys(lines)) {
    const line = key.index + 1;
    const where = key.job === null ? 'workflow-level `concurrency`' : `\`concurrency\` of job "${key.job}"`;
    let message: string;
    if (isConcurrencyMapping(key)) {
      if (key.value.startsWith('{') && !key.value.includes('}')) continue;
      if (cancelInProgressEntry(lines, key) !== null) continue;
      message = `${where} does not state \`cancel-in-progress\`. Whether a newer run cancels this one is then left to GitHub's default (false); write \`cancel-in-progress: true\` or \`false\` so the choice is explicit.`;
    } else if (requireMappingForm) {
      message = `${where} uses the string form, which cannot state \`cancel-in-progress\`. Write it as a mapping with \`group:\` and \`cancel-in-progress:\`.`;
    } else {
      continue;
    }
    violations.push({ file, rule: RULE_ID, line, message: `line ${String(line)}: ${message}` });
  }
  return violations;
}

/** A `concurrency` mapping, at workflow or job level, always states `cancel-in-progress`. */
export function createGithubActionsConcurrencyExplicitRule(
  options: GithubActionsConcurrencyExplicitOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  const requireMappingForm = options.requireMappingForm ?? false;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'A workflow-level or job-level `concurrency` mapping must state `cancel-in-progress`; the string form passes unless requireMappingForm is set.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowConcurrencyExplicit(file, ctx.read(file) ?? '', requireMappingForm),
      );
    },
  };
}
