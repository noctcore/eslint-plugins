import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import {
  DEFAULT_DOCKERFILE_GLOBS,
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKFLOW_GLOBS,
  asRecord,
  globFiles,
  readSourceText,
  stripYamlComment,
  unquote,
} from './shared';
import { stepKeys, workflowSteps } from './workflow-steps';

/** Options for {@link createNodeVersionParityRule}. */
export interface NodeVersionParityOptions {
  /** The file every other place is compared with. Default `'.nvmrc'` (`.node-version` works the same way). */
  readonly versionFile?: string;
  /** Check the root `package.json` `engines.node` floor. Default `true`. */
  readonly checkEngines?: boolean;
  /** Workflow files to scan for `actions/setup-node`. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Dockerfiles to scan for a node base image. Default `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` at any depth. */
  readonly dockerfileGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'node-version-parity';

type Triple = readonly [number, number, number];

function parseNodeVersion(text: string): Triple | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(text.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function below(a: Triple, b: Triple): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) < (b[index] ?? 0);
  }
  return false;
}

/**
 * A Dockerfile's instructions with every `\` continuation joined onto the line
 * it continues, each tagged with the index of its first physical line.
 */
function instructions(text: string): { line: string; index: number }[] {
  const out: { line: string; index: number }[] = [];
  let open: { line: string; index: number } | null = null;
  text.split('\n').forEach((physical, index) => {
    const continued = /\\\s*$/u.test(physical);
    const body = physical.replace(/\\\s*$/u, ' ');
    if (open === null) open = { line: body, index };
    else open.line += ` ${body.trim()}`;
    if (!continued) {
      out.push(open);
      open = null;
    }
  });
  if (open !== null) out.push(open);
  return out;
}

/**
 * Every place that picks a Node version agrees with the version file on the
 * major: the root `engines.node` floor, every `actions/setup-node` step, and
 * every Docker node base image. Developers' machines read the version file, the
 * installer refuses a Node below `engines.node`, CI installs through setup-node,
 * and images build on a node base. Four places drifting apart is a failure that
 * shows up in one of them only.
 *
 * Majors only for images: they are usually pinned by digest, and a digest hides
 * the minor it resolves to.
 */
export function createNodeVersionParityRule(options: NodeVersionParityOptions = {}): IMetaRule {
  const versionFile = options.versionFile ?? '.nvmrc';
  const checkEngines = options.checkEngines ?? true;
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const dockerfileGlobs = options.dockerfileGlobs ?? DEFAULT_DOCKERFILE_GLOBS;
  const ciCritical = options.ciCritical ?? true;

  const violation = (file: string, message: string): IViolation => ({ file, rule: RULE_ID, message });

  function engineViolations(ctx: IMetaCtx, pinned: Triple, pinnedText: string): IViolation[] {
    let engines: unknown;
    try {
      engines = asRecord(asRecord(JSON.parse(ctx.read('package.json') ?? '{}'))?.['engines'])?.['node'];
    } catch {
      return [violation('package.json', 'package.json is not valid JSON, so engines.node cannot be read.')];
    }
    if (typeof engines !== 'string') {
      return [violation('package.json', 'package.json has no engines.node, so nothing refuses an install on an older Node.')];
    }
    const floorText = /^>=\s*(\S+)$/u.exec(engines.trim())?.[1];
    const floor = floorText === undefined ? null : parseNodeVersion(floorText);
    if (floor === null) {
      return [violation('package.json', `engines.node "${engines}" is not a single >= floor, which this rule reads.`)];
    }
    if (floor[0] !== pinned[0]) {
      return [
        violation(
          'package.json',
          `engines.node "${engines}" starts at Node ${String(floor[0])}; ${versionFile} says ${String(pinned[0])}.`,
        ),
      ];
    }
    if (pinnedText.includes('.') && below(pinned, floor)) {
      return [
        violation(
          versionFile,
          `${versionFile} ${pinnedText} is below the engines.node floor ${floor.join('.')}: the installer refuses to run on it.`,
        ),
      ];
    }
    return [];
  }

  function workflowViolations(ctx: IMetaCtx, major: number): IViolation[] {
    const found: IViolation[] = [];
    for (const rel of globFiles((p) => ctx.glob(p), workflowGlobs)) {
      const lines = (readSourceText((file) => ctx.read(file), rel) ?? '').split('\n');
      for (const step of workflowSteps(lines)) {
        const keys = stepKeys(lines, step);
        const uses = unquote(stripYamlComment(keys.get('uses')?.[0] ?? ''));
        if (!uses.startsWith('actions/setup-node@')) continue;
        const withKeys = new Map(
          (keys.get('with') ?? []).flatMap((line) => {
            const pair = /^([\w-]+):\s*(.*)$/u.exec(line.trim());
            return pair === null ? [] : [[pair[1] ?? '', unquote(stripYamlComment(pair[2] ?? ''))] as const];
          }),
        );
        const where = `${rel}: setup-node in "${step.label}"`;
        const fileInput = withKeys.get('node-version-file');
        const literal = withKeys.get('node-version');
        // setup-node installs node-version when both are written, so a literal
        // is checked whether or not a version file sits beside it.
        if (fileInput !== undefined && fileInput !== versionFile) {
          found.push(violation(rel, `${where} reads ${fileInput}, not ${versionFile}.`));
        }
        if (fileInput === undefined && literal === undefined) {
          found.push(
            violation(
              rel,
              `${where} names neither node-version-file: ${versionFile} nor a node-version, so it installs whatever Node the runner image has.`,
            ),
          );
        } else if (literal !== undefined && !literal.includes('${{')) {
          const version = parseNodeVersion(literal.replace(/\.x$/u, ''));
          if (version?.[0] !== major) {
            found.push(
              violation(
                rel,
                `${where} installs Node ${literal}; ${versionFile} says ${String(major)}. Use node-version-file: ${versionFile}.`,
              ),
            );
          }
        }
      }
    }
    return found;
  }

  function dockerViolations(ctx: IMetaCtx, major: number): IViolation[] {
    const found: IViolation[] = [];
    for (const rel of globFiles((p) => ctx.glob(p), dockerfileGlobs, DEFAULT_SKIP_DIRS)) {
      const text = readSourceText((file) => ctx.read(file), rel);
      if (text === null) continue;
      for (const { line, index } of instructions(text)) {
        const where = `${rel}:${String(index + 1)}`;
        const base = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/iu.exec(line)?.[1];
        // `node:${NODE_VERSION}-slim` or `${NODE_IMAGE}` hides the major; a
        // variable base that does not mention node (`FROM ${BASE}`) may be any
        // image and is left alone.
        if (base !== undefined && base.includes('$') && /node/iu.test(base)) {
          found.push(
            violation(
              rel,
              `${where} builds FROM ${base}, which this rule cannot resolve: write the image out (node:${String(major)}-slim) so its Node major can be read.`,
            ),
          );
        }
        // A node image from any registry or mirror: the last path segment is `node`.
        // A base built from a variable was handled above.
        const from = base?.includes('$') === true ? null : /^((?:[^\s/]+\/)*node(?::([^\s@]+))?(?:@\S+)?)$/iu.exec(base ?? '');
        if (from !== null) {
          const image = from[1] ?? '';
          const tagMajor = /^(\d+)(?:[.-]|$)/u.exec(from[2] ?? '')?.[1];
          if (tagMajor === undefined) {
            found.push(
              violation(
                rel,
                `${where} builds FROM ${image}, whose tag names no Node major. Pin a numbered tag (node:${String(major)}-slim).`,
              ),
            );
          } else if (Number(tagMajor) !== major) {
            found.push(violation(rel, `${where} builds FROM ${image}, Node ${tagMajor}; ${versionFile} says ${String(major)}.`));
          }
        }
        const arg = /^\s*(?:ARG|ENV)\s+NODE_MAJOR[= ]\s*(\S+)/u.exec(line)?.[1];
        if (arg !== undefined && Number(arg) !== major) {
          found.push(violation(rel, `${where} sets NODE_MAJOR=${arg}; ${versionFile} says ${String(major)}.`));
        }
      }
    }
    return found;
  }

  return {
    id: RULE_ID,
    category: 'supply-chain',
    ciCritical,
    description: `${versionFile}, the root engines.node floor, every setup-node step and every Docker node base image agree on the Node major.`,
    run(ctx) {
      const raw = ctx.read(versionFile);
      // No version file: the repo has not chosen this convention, so there is nothing to compare with.
      if (raw === null) return [];
      const text = raw.trim();
      const pinned = parseNodeVersion(text);
      if (pinned === null) {
        return [
          violation(
            versionFile,
            `${versionFile} holds "${text}", which is not a Node version (22, 22.23.2 or v22.23.2), so nothing can be compared with it.`,
          ),
        ];
      }
      return [
        ...(checkEngines ? engineViolations(ctx, pinned, text.replace(/^v/u, '')) : []),
        ...workflowViolations(ctx, pinned[0]),
        ...dockerViolations(ctx, pinned[0]),
      ];
    },
  };
}
