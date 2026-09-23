import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment, unquote } from './shared';

/** Options for {@link createGithubActionsLeastPrivilegePermissionsRule}. */
export interface GithubActionsLeastPrivilegePermissionsOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /**
   * Scopes allowed at `write` in the top-level `permissions:` block (for example `contents` in a
   * release workflow whose every job pushes). Default none.
   */
  readonly allowTopLevelWrite?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-least-privilege-permissions';

const TOP_KEY = /^([\w-]+):\s*(.*)$/u;
const SCOPE_ENTRY = /^\s*['"]?([\w-]+)['"]?:\s*['"]?([\w-]+)['"]?\s*$/u;

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/** The top-level key on each column-0 line, with its inline value and 0-indexed line. */
interface TopKey {
  readonly key: string;
  readonly value: string;
  readonly index: number;
}

function topLevelKeys(lines: readonly string[]): TopKey[] {
  const keys: TopKey[] = [];
  lines.forEach((line, index) => {
    const match = TOP_KEY.exec(line);
    if (match === null) return;
    keys.push({ key: unquote(match[1] ?? ''), value: stripYamlComment(match[2] ?? '').trim(), index });
  });
  return keys;
}

/** The content lines of a column-0 key's block, each with its 0-indexed line. */
function blockOf(lines: readonly string[], index: number): { text: string; index: number }[] {
  const block: { text: string; index: number }[] = [];
  for (let j = index + 1; j < lines.length; j += 1) {
    const line = lines[j] ?? '';
    if (!isContent(line)) continue;
    if (indentOf(line) === 0) break;
    block.push({ text: stripYamlComment(line), index: j });
  }
  return block;
}

/** `scope: level` pairs in a flow mapping (`{ contents: write }`) or a block mapping. */
function scopeEntries(
  lines: readonly string[],
  permissions: TopKey,
): { scope: string; level: string; line: number }[] {
  if (permissions.value.startsWith('{')) {
    return permissions.value
      .replace(/^\{|\}$/gu, '')
      .split(',')
      .map((pair) => SCOPE_ENTRY.exec(pair))
      .filter((match) => match !== null)
      .map((match) => ({ scope: match[1] ?? '', level: match[2] ?? '', line: permissions.index + 1 }));
  }
  return blockOf(lines, permissions.index).flatMap(({ text, index }) => {
    const match = SCOPE_ENTRY.exec(text);
    return match === null ? [] : [{ scope: match[1] ?? '', level: match[2] ?? '', line: index + 1 }];
  });
}

/** Jobs under `jobs:` that declare no job-level `permissions:`. */
function jobsWithoutPermissions(lines: readonly string[], jobs: TopKey): string[] {
  const block = blockOf(lines, jobs.index);
  const jobColumn = indentOf(block[0]?.text ?? '');
  const missing: string[] = [];
  let current: { name: string; hasPermissions: boolean } | undefined;
  let keyColumn = -1;

  const settle = (): void => {
    if (current !== undefined && !current.hasPermissions) missing.push(current.name);
  };
  for (const { text } of block) {
    const column = indentOf(text);
    if (column === jobColumn) {
      settle();
      current = { name: unquote(text.trim().replace(/:.*$/u, '')), hasPermissions: false };
      keyColumn = -1;
      continue;
    }
    if (current === undefined || column < jobColumn) continue;
    if (keyColumn === -1) keyColumn = column;
    if (column === keyColumn && /^\s*permissions:/u.test(text)) current.hasPermissions = true;
  }
  settle();
  return missing;
}

/**
 * Check one workflow's text. The top-level `permissions:` is what every job's `GITHUB_TOKEN` gets
 * unless the job says otherwise, so a write there hands every job (and every third-party action
 * any job runs) the power to push code, cut releases or edit issues. Leaving it out is worse: the
 * token then gets the repository's default, which is read-write on many repositories. The fix is
 * a read-only top level (`contents: read`, or `{}`) and the writes on the one job that needs them.
 *
 * A workflow with no top-level block is left alone when every job declares its own
 * `permissions:`, because then the default reaches no job.
 */
export function checkWorkflowPermissions(
  file: string,
  text: string,
  allowTopLevelWrite: readonly string[] = [],
): IViolation[] {
  const lines = text.split('\n');
  const keys = topLevelKeys(lines);
  const permissions = keys.find((entry) => entry.key === 'permissions');
  const report = (line: number, message: string): IViolation => ({
    file,
    rule: RULE_ID,
    message: `line ${line}: ${message}`,
    line,
  });

  if (permissions === undefined) {
    const jobs = keys.find((entry) => entry.key === 'jobs');
    const missing = jobs === undefined ? [] : jobsWithoutPermissions(lines, jobs);
    if (missing.length === 0) return [];
    return [
      report(
        1,
        `no top-level \`permissions:\`, so ${missing.map((job) => `\`${job}\``).join(', ')} ${missing.length === 1 ? 'runs' : 'run'} with the repository's default token, which can be read-write. Add \`permissions: { contents: read }\` at the top and grant writes on the job that needs them.`,
      ),
    ];
  }

  const shorthand = unquote(permissions.value);
  if (shorthand === 'write-all' || shorthand === 'read-all') {
    return [
      report(
        permissions.index + 1,
        `top-level \`permissions: ${shorthand}\` grants every scope to every job. List only the scopes the workflow reads (for example \`contents: read\`) and grant writes on the job that needs them.`,
      ),
    ];
  }

  const allowed = new Set(allowTopLevelWrite);
  return scopeEntries(lines, permissions)
    .filter(({ scope, level }) => level === 'write' && !allowed.has(scope))
    .map(({ scope, line }) =>
      report(
        line,
        `top-level \`permissions\` grants \`${scope}: write\` to every job. Move it to the job that needs it and keep the top level read-only.`,
      ),
    );
}

/** A workflow's top-level `permissions:` exists, is not `*-all`, and grants no write. */
export function createGithubActionsLeastPrivilegePermissionsRule(
  options: GithubActionsLeastPrivilegePermissionsOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const allowTopLevelWrite = options.allowTopLevelWrite ?? [];
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'GitHub Actions workflows declare a read-only top-level `permissions:` (no `write-all`/`read-all`, no `<scope>: write`); writes go on the job that needs them.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowPermissions(file, ctx.read(file) ?? '', allowTopLevelWrite),
      );
    },
  };
}
