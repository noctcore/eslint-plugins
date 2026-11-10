import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { workspaceList, workspaceScalar } from './pnpm-workspace-yaml';
import {
  DEFAULT_DOCKERFILE_GLOBS,
  DEFAULT_MANIFEST_GLOBS,
  DEFAULT_SKIP_DIRS,
  DEFAULT_WORKFLOW_GLOBS,
  asRecord,
  escapeRegExp,
  globFiles,
  readManifests,
  readSourceText,
} from './shared';

/** Options for {@link createPnpmHardeningSettingsRule}. */
export interface PnpmHardeningSettingsOptions {
  /**
   * Settings that must hold an exact value in pnpm-workspace.yaml. Default
   * `strictDepBuilds: true`, `blockExoticSubdeps: true`, `engineStrict: true`,
   * `trustPolicy: no-downgrade`. A missing key counts as off.
   */
  readonly required?: Readonly<Record<string, string>>;
  /** The smallest `minimumReleaseAge` allowed, in minutes. Default `10080` (seven days). `0` skips the check. */
  readonly minimumReleaseAgeMinutes?: number;
  /**
   * The exact `minimumReleaseAgeExclude` list. Default `[]`: no package may skip
   * the release-age gate. Name your own scope here (`['@acme/*']`) if your
   * packages must install the day they ship.
   */
  readonly releaseAgeExclude?: readonly string[];
  /** Settings that must not be set at all. Default `trustPolicyIgnoreAfter`, `dangerouslyAllowAllBuilds`. */
  readonly forbidden?: readonly string[];
  /** Check that every `trustPolicyExclude` entry is an exact version under a comment naming it. Default `true`. */
  readonly checkTrustPolicyExclude?: boolean;
  /** Workflows scanned for a command-line override. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Dockerfiles scanned for a command-line override. Default `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` at any depth. */
  readonly dockerfileGlobs?: readonly string[];
  /** Manifests whose scripts are scanned for a command-line override. Default the root and `apps/*`, `packages/*`, `tools/*`. */
  readonly manifestGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'pnpm-hardening-settings';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

const DEFAULT_REQUIRED: Readonly<Record<string, string>> = {
  strictDepBuilds: 'true',
  blockExoticSubdeps: 'true',
  engineStrict: 'true',
  trustPolicy: 'no-downgrade',
};
const DEFAULT_FORBIDDEN: readonly string[] = ['trustPolicyIgnoreAfter', 'dangerouslyAllowAllBuilds'];

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const NAMED_VERSION = /^((?:@[^@/\s]+\/)?[^@/\s]+)@(\S+)$/u;

function violation(file: string, message: string): IViolation {
  return { file, rule: RULE_ID, message };
}

/** `trustPolicy` to `trust-policy`: the spelling .npmrc and the CLI use. */
function kebab(key: string): string {
  return key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

/** Whether `text` names `token` as a whole word: `1.2.3` is not found inside `11.2.3` or `1.2.30`. */
function names(text: string, token: string): boolean {
  return new RegExp(`(?<![\\w.@/-])${escapeRegExp(token)}(?![\\w/-]|\\.\\d)`, 'u').test(text);
}

/** The package and versions of an exact `name@1.2.3 || 4.5.6` entry, or null when it is not one. */
export function exactExclusion(entry: string): { name: string; versions: string[] } | null {
  const [first = '', ...rest] = entry.split('||').map((part) => part.trim());
  const named = NAMED_VERSION.exec(first);
  if (named?.[1] === undefined || named[2] === undefined) return null;
  const versions = [named[2], ...rest];
  return versions.every((version) => RELEASE_VERSION.test(version)) ? { name: named[1], versions } : null;
}

/** The first spelling of an override of `key` in `text`: a flag or an environment variable, or null. */
export function overrideOf(text: string, key: string): string | null {
  const kebabKey = kebab(key);
  const snake = kebabKey.replace(/-/gu, '_');
  const patterns = [
    new RegExp(`--config\\.(?:${kebabKey}|${key})(?![\\w-])`, 'u'),
    new RegExp(`--(?:no-)?${kebabKey}(?![\\w-])`, 'u'),
    new RegExp(`\\b(?:npm|pnpm)_config_${snake}\\b`, 'iu'),
  ];
  const hits = patterns.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null ? [] : [match];
  });
  hits.sort((a, b) => a.index - b.index);
  return hits[0]?.[0] ?? null;
}

/**
 * The install-time hardening in pnpm-workspace.yaml stays switched on. Each of
 * these settings turns something pnpm would only warn about into a failed
 * install, and each is one line that a frustrated install can flip back without
 * anybody noticing: the install simply works again.
 *
 * Reports, in pnpm-workspace.yaml: a `required` setting with another value or
 * missing; `minimumReleaseAge` below the floor or not a number; a
 * `minimumReleaseAgeExclude` other than the configured list; a
 * `trustPolicyExclude` entry that is not an exact version or has no comment
 * naming it; a `forbidden` setting set at all. Also any governed setting written
 * in `.npmrc` or the root `package.json` `pnpm` block (it would override the
 * workspace file or split the answer across two files), and a command-line
 * override (`--config.<key>`, `--[no-]<key>`, `npm_config_<key>`) in a workflow,
 * a Dockerfile or a manifest script.
 *
 * Dormant without a pnpm-workspace.yaml: a repo on another installer has
 * nothing here to check.
 */
export function createPnpmHardeningSettingsRule(options: PnpmHardeningSettingsOptions = {}): IMetaRule {
  const required = options.required ?? DEFAULT_REQUIRED;
  const minAge = options.minimumReleaseAgeMinutes ?? 10080;
  const releaseAgeExclude = options.releaseAgeExclude ?? [];
  const forbidden = options.forbidden ?? DEFAULT_FORBIDDEN;
  const checkTrustExclude = options.checkTrustPolicyExclude ?? true;
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const dockerfileGlobs = options.dockerfileGlobs ?? DEFAULT_DOCKERFILE_GLOBS;
  const manifestGlobs = options.manifestGlobs ?? DEFAULT_MANIFEST_GLOBS;
  const ciCritical = options.ciCritical ?? true;

  const governed = [
    ...Object.keys(required),
    ...(minAge > 0 ? ['minimumReleaseAge'] : []),
    'minimumReleaseAgeExclude',
    ...(checkTrustExclude ? ['trustPolicyExclude'] : []),
    ...forbidden,
  ];

  function workspaceViolations(text: string): IViolation[] {
    const found: IViolation[] = [];
    const report = (message: string): void => {
      found.push(violation(WORKSPACE_FILE, message));
    };

    for (const [key, expected] of Object.entries(required)) {
      const value = workspaceScalar(text, key);
      if (value !== expected) {
        report(
          `\`${key}\` is ${value === null ? 'not set' : `"${value}"`}; it must be "${expected}". Fix what the install reports instead of turning it off.`,
        );
      }
    }

    if (minAge > 0) {
      const age = workspaceScalar(text, 'minimumReleaseAge');
      if (age === null) {
        report(`\`minimumReleaseAge\` is not set; it must be at least ${String(minAge)} minutes.`);
      } else if (!/^\d+$/u.test(age)) {
        report(`\`minimumReleaseAge\` is "${age}", not a number of minutes; it must be at least ${String(minAge)}.`);
      } else if (Number(age) < minAge) {
        report(`\`minimumReleaseAge\` is ${age} minutes; it must be at least ${String(minAge)}.`);
      }
    }

    const exclude = workspaceList(text, 'minimumReleaseAgeExclude');
    const excluded = exclude === null ? [] : [...exclude.items.map((item) => item.value), ...exclude.unreadable];
    if (exclude === null && releaseAgeExclude.length > 0) {
      report(`\`minimumReleaseAgeExclude\` is not set; it must be exactly [${releaseAgeExclude.join(', ')}].`);
    } else if (excluded.join('\n') !== releaseAgeExclude.join('\n')) {
      report(
        `\`minimumReleaseAgeExclude\` is [${excluded.join(', ')}]; it must be exactly [${releaseAgeExclude.join(', ')}]. Every other package waits out the release age; never add a name to let one through.`,
      );
    }

    if (checkTrustExclude) {
      const trust = workspaceList(text, 'trustPolicyExclude');
      for (const line of trust?.unreadable ?? []) {
        report(
          `\`trustPolicyExclude\` holds "${line}", which this rule cannot read. Write one \`- 'name@1.2.3'\` entry per line, under a comment giving its reason.`,
        );
      }
      for (const item of trust?.items ?? []) {
        const exact = exactExclusion(item.value);
        if (exact === null) {
          report(
            `\`trustPolicyExclude\` entry "${item.value}" is not an exact version. Name each version (\`name@1.2.3\` or \`name@1.2.3 || 4.5.6\`), so the next release is judged again.`,
          );
          continue;
        }
        const unnamed = [exact.name, ...exact.versions].filter((token) => !names(item.reason, token));
        if (unnamed.length > 0) {
          report(
            `\`trustPolicyExclude\` entry "${item.value}" has no reason comment that names ${unnamed.join(' and ')}. Write above it why that version may skip the trust policy.`,
          );
        }
      }
    }

    for (const key of forbidden) {
      if (workspaceScalar(text, key) !== null) {
        report(`\`${key}\` is set. It switches a check off for every package at once; use an exact, reasoned exclusion instead.`);
      }
    }
    return found;
  }

  function overrideViolations(ctx: IMetaCtx): IViolation[] {
    const found: IViolation[] = [];
    const scan = (file: string, where: string, text: string): void => {
      for (const key of governed) {
        const hit = overrideOf(text, key);
        if (hit !== null) {
          found.push(
            violation(
              file,
              `${where} overrides \`${key}\` with "${hit}". The install settings live in pnpm-workspace.yaml only; an override at the command line switches them off for that run.`,
            ),
          );
        }
      }
    };
    const files = [
      ...globFiles((p) => ctx.glob(p), workflowGlobs),
      ...globFiles((p) => ctx.glob(p), dockerfileGlobs, DEFAULT_SKIP_DIRS),
    ];
    for (const rel of files) {
      const text = readSourceText((file) => ctx.read(file), rel);
      if (text !== null) scan(rel, rel, text);
    }
    for (const manifest of readManifests(ctx, manifestGlobs)) {
      if (!manifest.ok) {
        found.push(violation(manifest.file, `${manifest.file} ${manifest.reason}, so its scripts cannot be checked.`));
        continue;
      }
      for (const [name, command] of Object.entries(asRecord(manifest.pkg['scripts']) ?? {})) {
        scan(manifest.file, `${manifest.file} script "${name}"`, String(command));
      }
    }
    return found;
  }

  return {
    id: RULE_ID,
    category: 'supply-chain',
    ciCritical,
    description:
      'pnpm-workspace.yaml keeps the install hardening on (strictDepBuilds, blockExoticSubdeps, engineStrict, trustPolicy: no-downgrade, a minimum release age), every trustPolicyExclude entry exact and reasoned, and no governed setting is overridden in .npmrc, package.json or on a command line.',
    run(ctx) {
      const workspace = ctx.read(WORKSPACE_FILE);
      if (workspace === null) return [];
      const found = workspaceViolations(workspace);

      const npmrc = ctx.read('.npmrc') ?? '';
      for (const key of governed) {
        if (new RegExp(`^\\s*${kebab(key)}\\s*=`, 'mu').test(npmrc)) {
          found.push(
            violation('.npmrc', `.npmrc sets \`${kebab(key)}\`. Keep it in pnpm-workspace.yaml only, where ${RULE_ID} checks it.`),
          );
        }
      }

      let pnpmBlock: Record<string, unknown> = {};
      try {
        pnpmBlock = asRecord(asRecord(JSON.parse(ctx.read('package.json') ?? '{}'))?.['pnpm']) ?? {};
      } catch {
        found.push(violation('package.json', 'package.json is not valid JSON, so its pnpm block cannot be checked.'));
      }
      for (const key of governed) {
        if (key in pnpmBlock) {
          found.push(
            violation('package.json', `package.json sets \`pnpm.${key}\`. Keep it in pnpm-workspace.yaml only, where ${RULE_ID} checks it.`),
          );
        }
      }
      return [...found, ...overrideViolations(ctx)];
    },
  };
}
