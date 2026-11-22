import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, asRecord, globFiles, stripYamlComment, unquote } from './shared';
import { stepKeys, workflowJobPermissions, workflowSteps, type WorkflowStep } from './workflow-steps';

/** A package manager whose install the rule knows how to see. */
export type PackageCacheManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Options for {@link createGithubActionsPackageCacheRule}. */
export interface GithubActionsPackageCacheOptions {
  /** The managers whose installs are checked. Default `['npm', 'pnpm', 'yarn', 'bun']`. */
  readonly managers?: readonly PackageCacheManager[];
  /** Setup actions whose `cache:` input caches npm, pnpm or yarn, matched on the name before `@`. Default `['actions/setup-node']`. */
  readonly setupActions?: readonly string[];
  /** Cache actions that count as a cache step for any manager, matched on the name before `@`. Default `['actions/cache', 'actions/cache/restore']`. */
  readonly cacheActions?: readonly string[];
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-package-cache';
const DEFAULT_MANAGERS: readonly PackageCacheManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
const DEFAULT_SETUP_ACTIONS = ['actions/setup-node'] as const;
const DEFAULT_CACHE_ACTIONS = ['actions/cache', 'actions/cache/restore'] as const;
const NODE_MANAGERS = new Set<PackageCacheManager>(['npm', 'pnpm', 'yarn']);

/*
 * An install command at a command position: the start of the line, or after
 * `&&`, `||`, `;`, `|` or `(`. `npm ci`, `npm install` / `npm i`, `pnpm install`
 * / `pnpm i`, `yarn install`, a bare `yarn` (alone or followed by flags only),
 * `bun install` / `bun i`. A global install (`-g`, `--global`) and
 * `--lockfile-only` download no project tree, so they are not installs here.
 */
const COMMAND_START = String.raw`(?:^|&&|\|\||[;|(])\s*`;
const INSTALLS: readonly { manager: PackageCacheManager; pattern: RegExp }[] = [
  { manager: 'npm', pattern: new RegExp(`${COMMAND_START}npm\\s+(?:ci|install|i)(?=\\s|$|[;&|)])([^;&|)]*)`, 'u') },
  { manager: 'pnpm', pattern: new RegExp(`${COMMAND_START}pnpm\\s+(?:install|i)(?=\\s|$|[;&|)])([^;&|)]*)`, 'u') },
  { manager: 'yarn', pattern: new RegExp(`${COMMAND_START}yarn(?:\\s+install)?(?=\\s*(?:$|[;&|)]|-))([^;&|)]*)`, 'u') },
  { manager: 'bun', pattern: new RegExp(`${COMMAND_START}bun\\s+(?:install|i)(?=\\s|$|[;&|)])([^;&|)]*)`, 'u') },
];

function actionName(uses: string): string {
  return unquote(stripYamlComment(uses)).split('@')[0]?.trim().toLowerCase() ?? '';
}

/** Flags that make an install command fetch no project tree: a global install, a lockfile-only resolve, a version or help query. */
const NO_TREE_FLAGS = new Set(['-g', '--global', '--lockfile-only', '-v', '--version', '-h', '--help']);

/**
 * Whether an install command's arguments still fetch the project tree. Package
 * arguments (`npm install lodash`) do: the command installs the tree as well.
 */
function downloadsTree(args: string): boolean {
  return !args.trim().split(/\s+/u).some((token) => NO_TREE_FLAGS.has(token));
}

/** The managers a `run:` value installs with, in the order they first appear. */
export function installsIn(runLines: readonly string[]): PackageCacheManager[] {
  const found: PackageCacheManager[] = [];
  for (const raw of runLines) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    for (const { manager, pattern } of INSTALLS) {
      const match = pattern.exec(line);
      if (match !== null && downloadsTree(match[1] ?? '') && !found.includes(manager)) found.push(manager);
    }
  }
  return found;
}

/** The manager a root `package.json` names in `packageManager` or `devEngines.packageManager`, or null. */
function declaredManager(rootManifest: string | null): string | null {
  if (rootManifest === null) return null;
  try {
    const pkg = asRecord(JSON.parse(rootManifest));
    if (pkg === null) return null;
    const field = pkg['packageManager'];
    if (typeof field === 'string') return field.split('@')[0] ?? null;
    const engines = asRecord(asRecord(pkg['devEngines'])?.['packageManager']);
    const name = engines?.['name'];
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

interface JobStep {
  readonly step: WorkflowStep;
  readonly keys: Map<string, readonly string[]>;
  readonly uses: string;
}

/** The `with:` input of a step, unquoted, or undefined when it is not set. */
function withInput(step: JobStep, input: string): string | undefined {
  for (const line of step.keys.get('with') ?? []) {
    const match = new RegExp(`^${input}:\\s*(.*?)\\s*$`, 'u').exec(stripYamlComment(line).trim());
    if (match !== null) return unquote(match[1] ?? '');
  }
  return undefined;
}

/** Check one workflow's text: every job that installs with a checked manager restores that manager's cache. */
export function checkWorkflowPackageCache(
  file: string,
  text: string,
  options: {
    readonly managers: readonly PackageCacheManager[];
    readonly setupActions: readonly string[];
    readonly cacheActions: readonly string[];
    readonly rootManifest: string | null;
  },
): IViolation[] {
  const lines = text.split('\n');
  const managers = new Set(options.managers);
  const setupActions = new Set(options.setupActions.map(actionName));
  const cacheActions = new Set(options.cacheActions.map(actionName));
  const steps = workflowSteps(lines);
  const violations: IViolation[] = [];

  for (const job of workflowJobPermissions(lines)) {
    const jobSteps: JobStep[] = steps
      .filter((step) => step.start >= job.start && step.start < job.end)
      .map((step) => {
        const keys = stepKeys(lines, step);
        return { step, keys, uses: actionName(keys.get('uses')?.[0] ?? '') };
      });
    if (jobSteps.some((step) => cacheActions.has(step.uses))) continue;

    const installs = new Map<PackageCacheManager, JobStep>();
    for (const step of jobSteps) {
      for (const manager of installsIn(step.keys.get('run') ?? [])) {
        if (managers.has(manager) && !installs.has(manager)) installs.set(manager, step);
      }
    }
    if (installs.size === 0) continue;

    const setup = jobSteps.find((step) => setupActions.has(step.uses));
    for (const [manager, installStep] of installs) {
      const installLine = installStep.step.start + 1;
      if (manager === 'bun') {
        violations.push({
          file,
          rule: RULE_ID,
          line: installLine,
          message: `line ${String(installLine)}: job "${job.name}" runs \`bun install\` with no cache step, so every run downloads the whole dependency tree again. The Bun setup action caches only the bun binary: add an \`actions/cache\` step for \`~/.bun/install/cache\` keyed on \`bun.lock\` before the install.`,
        });
        continue;
      }
      if (!NODE_MANAGERS.has(manager) || setup === undefined) continue;
      const cache = withInput(setup, 'cache');
      const setupLine = setup.step.start + 1;
      if (cache === undefined || cache === '') {
        const automatic =
          manager === 'npm' &&
          declaredManager(options.rootManifest) === 'npm' &&
          withInput(setup, 'package-manager-cache') !== 'false';
        if (automatic) continue;
        violations.push({
          file,
          rule: RULE_ID,
          line: setupLine,
          message: `line ${String(setupLine)}: job "${job.name}" installs with ${manager} (line ${String(installLine)}) but its \`${setup.uses}\` step sets no \`cache:\`, so every run downloads the whole dependency tree again. Add \`cache: ${manager}\` under \`with:\`.`,
        });
        continue;
      }
      if (cache.includes('${{')) continue;
      if (cache !== manager) {
        violations.push({
          file,
          rule: RULE_ID,
          line: setupLine,
          message: `line ${String(setupLine)}: job "${job.name}" installs with ${manager} (line ${String(installLine)}) but its \`${setup.uses}\` step caches \`${cache}\`, so the ${manager} store is never restored. Set \`cache: ${manager}\`.`,
        });
      }
    }
  }
  return violations;
}

/** A job that installs dependencies restores the package manager's cache. */
export function createGithubActionsPackageCacheRule(options: GithubActionsPackageCacheOptions = {}): IMetaRule {
  const managers = options.managers ?? DEFAULT_MANAGERS;
  const setupActions = options.setupActions ?? DEFAULT_SETUP_ACTIONS;
  const cacheActions = options.cacheActions ?? DEFAULT_CACHE_ACTIONS;
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'A job that installs with npm, pnpm or yarn must set the matching `cache:` on its `actions/setup-node` step, and a job that runs `bun install` must have an `actions/cache` step.',
    run(ctx) {
      const rootManifest = ctx.read('package.json');
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowPackageCache(file, ctx.read(file) ?? '', { managers, setupActions, cacheActions, rootManifest }),
      );
    },
  };
}
