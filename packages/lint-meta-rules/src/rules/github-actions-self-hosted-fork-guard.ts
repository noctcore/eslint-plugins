import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment, unquote } from './shared';

/** Options for {@link createGithubActionsSelfHostedForkGuardRule}. */
export interface GithubActionsSelfHostedForkGuardOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /**
   * `runs-on` expressions, beyond the literal `self-hosted` label, that resolve to a self-hosted
   * runner (for example `vars.CI_RUNNER`). Matched as a substring, ignoring whitespace. Default `[]`.
   */
  readonly selfHostedExpressions?: readonly string[];
  /**
   * The text that must appear inside `runs-on` to keep fork pull requests off the self-hosted
   * runner, matched ignoring whitespace. Default `!github.event.pull_request.head.repo.fork`.
   */
  readonly forkGuard?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-self-hosted-fork-guard';

const RUNS_ON = /^(\s*)runs-on:\s*(.*)$/u;
const ON_KEY = /^(?:on|"on"|'on'):\s*(.*)$/u;
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/u;
const SELF_HOSTED_LABEL = /(?:^|[^\w.-])self-hosted(?![\w.-])/iu;
const DEFAULT_FORK_GUARD = '!github.event.pull_request.head.repo.fork';

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

function withoutWhitespace(value: string): string {
  return value.replace(/\s+/gu, '');
}

function childName(line: string): string {
  const text = line.trim();
  if (text.startsWith('-')) {
    return unquote(text.slice(1));
  }
  const colon = text.indexOf(':');
  return unquote(colon === -1 ? text : text.slice(0, colon));
}

/*
 * True when the workflow's `on:` selects `pull_request`: an inline value (scalar, flow list or flow
 * mapping) holding that exact token, or a block whose direct children include it. Exact equality
 * keeps `pull_request_target` and deeper lines (a `paths:` item) out.
 */
function pullRequestTriggered(lines: readonly string[]): boolean {
  const start = lines.findIndex((line) => ON_KEY.test(line));
  if (start === -1) {
    return false;
  }

  const inline = ON_KEY.exec(lines[start] ?? '')?.[1]?.trim() ?? '';
  if (inline !== '') {
    return inline.split(/[\s,[\]{}:'"]+/u).includes('pull_request');
  }

  let childIndent = -1;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      continue;
    }
    const indent = indentOf(line);
    if (indent === 0) {
      break;
    }
    if (childIndent === -1) {
      childIndent = indent;
    }
    if (indent === childIndent && childName(line) === 'pull_request') {
      return true;
    }
  }
  return false;
}

/*
 * The text of one `runs-on:`: its inline value, plus the deeper-indented lines under it when the
 * value is empty or a block scalar. Unlike a label reader it keeps `${{ }}` expressions.
 */
function runsOnText(lines: readonly string[], start: number, indent: number): string {
  const inline = (RUNS_ON.exec(lines[start] ?? '')?.[2] ?? '').trim();
  const collected = [inline];

  if (inline === '' || BLOCK_SCALAR_HEADER.test(inline)) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === '') {
        continue;
      }
      if (indentOf(line) <= indent) {
        break;
      }
      collected.push(line.trim());
    }
  }

  return collected.join(' ');
}

function selfHostedMatch(text: string, expressions: readonly string[]): string | null {
  if (SELF_HOSTED_LABEL.test(text)) {
    return 'self-hosted';
  }
  const compact = withoutWhitespace(text);
  for (const expression of expressions) {
    const needle = withoutWhitespace(expression);
    if (needle !== '' && compact.includes(needle)) {
      return expression;
    }
  }
  return null;
}

/**
 * Check one workflow's text. A `pull_request` workflow from a fork runs the fork's code; on a
 * self-hosted runner that code reaches the owner's machine. The guard in `runs-on` sends fork pull
 * requests to a GitHub-hosted runner instead.
 */
export function checkWorkflowSelfHostedForkGuard(
  file: string,
  text: string,
  selfHostedExpressions: readonly string[] = [],
  forkGuard: string = DEFAULT_FORK_GUARD,
): IViolation[] {
  const lines = text.split('\n').map(stripYamlComment);
  if (!pullRequestTriggered(lines)) {
    return [];
  }

  const guard = withoutWhitespace(forkGuard);
  const violations: IViolation[] = [];

  lines.forEach((line, index) => {
    const match = RUNS_ON.exec(line);
    if (match === null) {
      return;
    }

    const runsOn = runsOnText(lines, index, match[1]?.length ?? 0);
    const selected = selfHostedMatch(runsOn, selfHostedExpressions);
    if (selected === null || (guard !== '' && withoutWhitespace(runsOn).includes(guard))) {
      return;
    }

    violations.push({
      file,
      rule: RULE_ID,
      message: `line ${index + 1}: \`runs-on\` selects the self-hosted runner "${selected}" in a workflow triggered by \`pull_request\` without the fork guard \`${forkGuard}\`. A pull request from a fork would run its code on that runner. Put the guard in \`runs-on\`, for example \`\${{ !github.event.pull_request.head.repo.fork && 'self-hosted' || 'ubuntu-24.04' }}\`.`,
      line: index + 1,
    });
  });

  return violations;
}

/** A `pull_request` workflow must not run on a self-hosted runner without a fork guard in `runs-on`. */
export function createGithubActionsSelfHostedForkGuardRule(
  options: GithubActionsSelfHostedForkGuardOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const selfHostedExpressions = options.selfHostedExpressions ?? [];
  const forkGuard = options.forkGuard ?? DEFAULT_FORK_GUARD;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'A GitHub Actions job triggered by pull_request must not run on a self-hosted runner unless runs-on carries a fork guard.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowSelfHostedForkGuard(file, ctx.read(file) ?? '', selfHostedExpressions, forkGuard),
      );
    },
  };
}
