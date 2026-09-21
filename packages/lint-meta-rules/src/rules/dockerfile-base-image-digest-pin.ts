import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_SKIP_DIRS, anywhereGlobs, globFiles } from './shared';

/**
 * Options for {@link createDockerfileBaseImageDigestPinRule}.
 *
 * Ported from a private monorepo that walked the whole tree with a hardcoded Dockerfile
 * name regex and skip list; both are now options.
 */
export interface DockerfileBaseImageDigestPinOptions {
  /**
   * Globs that find Dockerfiles. Default `Dockerfile`, `Dockerfile.*` and
   * `*.Dockerfile` at any depth, dot-directories included.
   */
  readonly dockerfileGlobs?: readonly string[];
  /** A path with any of these segments is skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'dockerfile-base-image-digest-pin';

const DEFAULT_DOCKERFILE_GLOBS = anywhereGlobs(['Dockerfile', 'Dockerfile.*', '*.Dockerfile']);
const FROM_LINE = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/iu;
const ARG_DEFAULT = /^\s*ARG\s+(\w+)=(\S+)\s*$/iu;
const DIGEST = /@sha256:[0-9a-f]{64}$/u;

/**
 * Check one Dockerfile's text. A tag (`FROM node:22-slim`) names whatever the
 * registry serves at build time, so two builds of one commit can differ and a
 * moved tag ships a change nobody reviewed. `tag@sha256:<digest>` keeps the tag
 * for readers and fixes the bytes.
 *
 * Exempt: `FROM scratch` and `FROM <earlier stage>`. An image chosen through a
 * build arg (`FROM ${BASE}`) is resolved from its `ARG BASE=<default>` before the
 * first FROM; one that cannot be resolved is reported, since the text does not
 * show what is being pulled.
 */
export function checkDockerfileBases(file: string, text: string): IViolation[] {
  const violations: IViolation[] = [];
  const stages = new Set<string>();
  const argDefaults = new Map<string, string>();
  let seenFrom = false;

  text.split('\n').forEach((line, index) => {
    const arg = ARG_DEFAULT.exec(line);
    if (arg?.[1] !== undefined && arg[2] !== undefined && !seenFrom) {
      argDefaults.set(arg[1], arg[2].replace(/^(['"])(.*)\1$/u, '$2'));
    }

    const from = FROM_LINE.exec(line);
    if (from?.[1] === undefined) {
      return;
    }
    seenFrom = true;

    const written = from[1];
    const variable = /^\$\{?(\w+)\}?$/u.exec(written)?.[1];
    const image = variable === undefined ? written : (argDefaults.get(variable) ?? written);

    const isExempt = image.toLowerCase() === 'scratch' || stages.has(image.toLowerCase());
    if (from[2] !== undefined) {
      stages.add(from[2].toLowerCase());
    }

    if (!isExempt && !DIGEST.test(image)) {
      const reference = image.split('@')[0];
      violations.push({
        file,
        rule: RULE_ID,
        message: `line ${index + 1}: base image "${image}" is not pinned by digest. Write \`FROM ${reference}@sha256:<digest>\` (resolve it with \`docker buildx imagetools inspect ${reference}\`).`,
        line: index + 1,
      });
    }
  });

  return violations;
}

/** Every Dockerfile FROM must pin its base image by digest. */
export function createDockerfileBaseImageDigestPinRule(
  options: DockerfileBaseImageDigestPinOptions = {},
): IMetaRule {
  const dockerfileGlobs = options.dockerfileGlobs ?? DEFAULT_DOCKERFILE_GLOBS;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'Dockerfile FROM base images must be pinned by `@sha256:` digest (scratch and earlier build stages exempt).',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), dockerfileGlobs, skipDirs).flatMap((file) =>
        checkDockerfileBases(file, ctx.read(file) ?? ''),
      );
    },
  };
}
