import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_MANIFEST_GLOBS, asRecord, readManifests } from './shared';

/** Options for {@link createBannedDependenciesRule}. */
export interface BannedDependenciesOptions {
  /**
   * Package name to the reason it is banned, quoted in the message. Default `{}`:
   * the rule reports nothing until you name a package.
   */
  readonly banned?: Readonly<Record<string, string>>;
  /** Manifests to read. Default the root `package.json` and `apps/*`, `packages/*`, `tools/*`. */
  readonly manifestGlobs?: readonly string[];
  /** Manifest fields to read. Default `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`. */
  readonly dependencyFields?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'banned-dependencies';

const DEFAULT_DEPENDENCY_FIELDS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/**
 * No workspace manifest may declare a banned package. This exists for the
 * dependency something else will try to reinstall behind your back: a review
 * catches a hand-written `add`, not a CLI that writes the dependency itself and
 * leaves a dirty manifest nobody authored, nor a package the team has decided
 * against (a vulnerable HTTP client, a deprecated fork) coming back in a new
 * workspace.
 */
export function createBannedDependenciesRule(options: BannedDependenciesOptions = {}): IMetaRule {
  const banned = options.banned ?? {};
  const manifestGlobs = options.manifestGlobs ?? DEFAULT_MANIFEST_GLOBS;
  const fields = options.dependencyFields ?? DEFAULT_DEPENDENCY_FIELDS;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'supply-chain',
    ciCritical,
    description: 'Workspace manifests must not declare a banned dependency.',
    run(ctx) {
      if (Object.keys(banned).length === 0) return [];
      const violations: IViolation[] = [];
      for (const manifest of readManifests(ctx, manifestGlobs)) {
        if (!manifest.ok) continue;
        for (const field of fields) {
          for (const name of Object.keys(asRecord(manifest.pkg[field]) ?? {})) {
            const reason = Object.hasOwn(banned, name) ? banned[name] : undefined;
            if (reason === undefined) continue;
            violations.push({
              file: manifest.file,
              rule: RULE_ID,
              message: `\`${name}\` is banned from this repo but appears in ${field}. ${reason}`,
            });
          }
        }
      }
      return violations;
    },
  };
}
