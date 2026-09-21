import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKFLOW_GLOBS,
  anywhereGlobs,
  globFiles,
  stripYamlComment,
  unquote,
} from './shared';

/**
 * Options for {@link createServiceImageDigestPinRule}.
 *
 * Ported from a private monorepo that hardcoded a one-entry exemption list (an
 * OpenTelemetry collector tag its registry does not serve), a compose file name
 * regex, a skip list and a pre-collected `workflowFiles` list. All four are now
 * options; the exemption list defaults to empty.
 */
export interface ServiceImageDigestPinOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Globs that find compose files. Default every `compose` / `docker-compose` `.yml` / `.yaml` variant at any depth, dot-directories included. */
  readonly composeGlobs?: readonly string[];
  /** A compose path with any of these segments is skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /**
   * Exact image refs that are allowed unpinned, for a ref the registry cannot
   * serve a digest for. Each entry should say why in the consumer's config.
   * Default none.
   */
  readonly allowUnpinned?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'service-image-digest-pin';

const DIGEST = /@sha256:[0-9a-f]{64}$/u;
const KEY_LINE = /^(\s*)(?:-\s+)?([\w-]+):\s*(.*)$/u;
const DEFAULT_COMPOSE_GLOBS = anywhereGlobs(
  ['compose', 'docker-compose'].flatMap((stem) =>
    ['', '.*', '-*'].flatMap((infix) => ['yml', 'yaml'].map((ext) => `${stem}${infix}.${ext}`)),
  ),
);

/** One image reference and the 1-indexed line it sits on. */
export interface ImageRef {
  readonly line: number;
  readonly image: string;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/**
 * Images a workflow pulls: `image:` under a job's `services:` and a job's
 * `container:` (scalar or mapping form). An action step's `with: image:` input
 * is not one.
 */
export function workflowImages(text: string): ImageRef[] {
  const found: ImageRef[] = [];
  const stack: { indent: number; key: string }[] = [];

  text.split('\n').forEach((line, index) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      return;
    }

    const match = KEY_LINE.exec(line);
    if (match === null) {
      return;
    }

    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? '';
    const value = unquote(stripYamlComment(match[3] ?? '').trim());

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop();
    }

    const insideService = stack.some((entry) => entry.key === 'services');
    const isContainerScalar = key === 'container' && value !== '';
    const isImageKey = key === 'image' && value !== '';
    const insideContainer = stack.some((entry) => entry.key === 'container');

    if (isContainerScalar || (isImageKey && (insideService || insideContainer))) {
      found.push({ line: index + 1, image: value });
    }

    stack.push({ indent, key });
  });

  return found;
}

/**
 * Images a compose file pulls: every service's `image:`, except a service that
 * also has `build:` (there `image:` names the tag of an image built locally,
 * which has no upstream digest).
 */
export function composeImages(text: string): ImageRef[] {
  const lines = text.split('\n');
  const found: ImageRef[] = [];
  const servicesAt = lines.findIndex((line) => /^services:\s*(?:#.*)?$/u.test(line));
  if (servicesAt === -1) {
    return found;
  }

  let serviceIndent: number | null = null;
  let propertyIndent: number | null = null;
  let current: { images: ImageRef[]; hasBuild: boolean } | null = null;
  const flush = (): void => {
    if (current !== null && !current.hasBuild) {
      found.push(...current.images);
    }
    current = null;
  };

  for (let index = servicesAt + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }

    const indent = indentOf(line);
    if (indent === 0) {
      break;
    }

    serviceIndent ??= indent;
    const match = KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }

    if (indent === serviceIndent) {
      flush();
      current = { images: [], hasBuild: false };
      propertyIndent = null;
      continue;
    }

    propertyIndent ??= indent;
    if (current === null || indent !== propertyIndent) {
      continue;
    }

    const value = unquote(stripYamlComment(match[3] ?? '').trim());
    if (match[2] === 'build') {
      current.hasBuild = true;
    } else if (match[2] === 'image' && value !== '') {
      current.images.push({ line: index + 1, image: value });
    }
  }
  flush();

  return found;
}

function violationsFor(
  file: string,
  images: readonly ImageRef[],
  allowUnpinned: ReadonlySet<string>,
): IViolation[] {
  return images
    .filter(({ image }) => !DIGEST.test(image) && !allowUnpinned.has(image))
    .map(({ line, image }) => {
      const reference = image.split('@')[0];
      return {
        file,
        rule: RULE_ID,
        message: `line ${line}: image "${image}" is not pinned by digest. Write \`${reference}@sha256:<digest>\` (resolve it with \`docker buildx imagetools inspect ${reference}\`) so CI and local runs use the same bytes.`,
        line,
      };
    });
}

/**
 * Every workflow service/container image and every compose image must be pinned
 * by digest. A tag (`postgres:17-alpine`) or `latest` names whatever the registry
 * serves today, so a green build can change under an unchanged commit.
 * `tag@sha256:<digest>` keeps the readable tag and fixes the content.
 */
export function createServiceImageDigestPinRule(
  options: ServiceImageDigestPinOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const composeGlobs = options.composeGlobs ?? DEFAULT_COMPOSE_GLOBS;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const allowUnpinned = new Set(options.allowUnpinned ?? []);
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'Workflow service and container images, and docker-compose images, must be pinned by `@sha256:` digest (a service that builds locally is exempt).',
    run(ctx) {
      const glob = (p: string): string[] => ctx.glob(p);
      const workflowViolations = globFiles(glob, workflowGlobs).flatMap((file) =>
        violationsFor(file, workflowImages(ctx.read(file) ?? ''), allowUnpinned),
      );
      const composeViolations = globFiles(glob, composeGlobs, skipDirs).flatMap((file) =>
        violationsFor(file, composeImages(ctx.read(file) ?? ''), allowUnpinned),
      );
      return [...workflowViolations, ...composeViolations];
    },
  };
}
