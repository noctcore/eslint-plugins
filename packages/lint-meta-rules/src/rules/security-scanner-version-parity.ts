import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, escapeRegExp, globFiles } from './shared';

/**
 * Options for {@link createSecurityScannerVersionParityRule}.
 *
 * Ported from a private monorepo that hardcoded gitleaks, its `GITLEAKS_VERSION` /
 * `GITLEAKS_IMAGE` variable names, the hook path `scripts/ci/pre-push.sh` and a
 * pre-collected `workflowFiles` list. Each is now an option whose default is the
 * original value, so the rule can pin any scanner that prints `<scanner> version`.
 */
export interface SecurityScannerVersionParityOptions {
  /** The scanner's binary name, as it appears in the hook and in its image name. Default `gitleaks`. */
  readonly scanner?: string;
  /** The env / shell variable both sides pin the version in. Default `GITLEAKS_VERSION`. */
  readonly versionVariable?: string;
  /** The hook's optional image variable, whose `<scanner>:vX.Y.Z` tag must agree. Default `GITLEAKS_IMAGE`. */
  readonly imageVariable?: string;
  /** The local hook script, repo-relative. Default `scripts/ci/pre-push.sh`. */
  readonly hookFile?: string;
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'security-scanner-version-parity';

/**
 * Different scanner versions ship different rulesets, so a push can pass the
 * local hook and fail CI (or the reverse) with no code difference. This ties
 * three things together:
 *
 *   - every workflow that pins the version variable pins the same one,
 *   - the hook declares the same variable equal to it (and a literal image tag,
 *     if it has one, agrees too),
 *   - the hook actually runs `<scanner> version`, so a drifted native install is
 *     caught at run time.
 *
 * Dormant when neither side mentions the scanner.
 */
export function createSecurityScannerVersionParityRule(
  options: SecurityScannerVersionParityOptions = {},
): IMetaRule {
  const scanner = options.scanner ?? 'gitleaks';
  const versionVariable = options.versionVariable ?? 'GITLEAKS_VERSION';
  const imageVariable = options.imageVariable ?? 'GITLEAKS_IMAGE';
  const hookFile = options.hookFile ?? 'scripts/ci/pre-push.sh';
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const ciCritical = options.ciCritical ?? true;

  const name = escapeRegExp(scanner);
  const versionVar = escapeRegExp(versionVariable);
  const workflowVersion = new RegExp(
    `^\\s*${versionVar}:\\s*['"]?(\\d+\\.\\d+\\.\\d+)['"]?\\s*(?:#.*)?$`,
    'mu',
  );
  const hookVersion = new RegExp(
    `^\\s*(?:readonly\\s+)?${versionVar}=['"]?(\\d+\\.\\d+\\.\\d+)['"]?\\s*(?:#.*)?$`,
    'mu',
  );
  const hookImageTag = new RegExp(
    `^\\s*${escapeRegExp(imageVariable)}=['"][^'"\\n]*${name}:v(\\d+\\.\\d+\\.\\d+)['"]`,
    'mu',
  );
  const runtimeCheck = new RegExp(`\\b${name}\\s+version\\b`, 'u');
  const mentionsScanner = new RegExp(name, 'iu');

  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description: `The ${scanner} version pinned in the workflows must equal the one in ${hookFile}, and the hook must compare a native ${scanner} against it at run time.`,
    run(ctx) {
      const hookText = ctx.read(hookFile) ?? '';

      const ciVersions = new Map<string, string[]>();
      for (const file of globFiles((p) => ctx.glob(p), workflowGlobs)) {
        const version = workflowVersion.exec(ctx.read(file) ?? '')?.[1];
        if (version !== undefined) {
          ciVersions.set(version, [...(ciVersions.get(version) ?? []), file]);
        }
      }

      const hookUsesScanner = mentionsScanner.test(hookText);
      if (ciVersions.size === 0 && !hookUsesScanner) {
        return [];
      }

      const violations: IViolation[] = [];
      const report = (file: string, message: string): void => {
        violations.push({ file, rule: RULE_ID, message });
      };

      if (ciVersions.size > 1) {
        report(
          [...ciVersions.values()].flat()[0] ?? hookFile,
          `Workflows pin different ${scanner} versions (${[...ciVersions.keys()].join(', ')}). Use one \`${versionVariable}\` everywhere.`,
        );
      }

      const ciVersion = ciVersions.size === 1 ? [...ciVersions.keys()][0] : undefined;

      if (ciVersions.size === 0) {
        report(
          hookFile,
          `${hookFile} runs ${scanner} but no workflow pins \`${versionVariable}\`, so CI's scanner version is unknown. Pin it in the workflow env.`,
        );
      }

      if (!hookUsesScanner) {
        report(
          hookFile,
          `Workflows pin ${scanner} ${ciVersion ?? ''} but ${hookFile} does not run ${scanner}, so the local hook cannot agree with CI.`,
        );
        return violations;
      }

      const declared = hookVersion.exec(hookText)?.[1];
      if (declared === undefined) {
        report(
          hookFile,
          `${hookFile} does not declare \`${versionVariable}="x.y.z"\`. Declare the version CI pins (${ciVersion ?? 'see the workflow'}) and derive the Docker image tag from it.`,
        );
      } else if (ciVersion !== undefined && declared !== ciVersion) {
        report(
          hookFile,
          `${hookFile} pins ${scanner} ${declared} but CI pins ${ciVersion}. Bump them together.`,
        );
      }

      const imageTag = hookImageTag.exec(hookText)?.[1];
      if (imageTag !== undefined && ciVersion !== undefined && imageTag !== ciVersion) {
        report(
          hookFile,
          `${hookFile} \`${imageVariable}\` is tagged v${imageTag} but CI pins ${ciVersion}. Derive the tag from \`${versionVariable}\` or bump it.`,
        );
      }

      if (!runtimeCheck.test(hookText)) {
        report(
          hookFile,
          `${hookFile} never runs \`${scanner} version\`. A native ${scanner} of another version scans with another ruleset: compare it with \`${versionVariable}\` and refuse a mismatch.`,
        );
      }

      return violations;
    },
  };
}
