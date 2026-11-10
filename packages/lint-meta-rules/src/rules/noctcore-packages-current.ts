import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_MANIFEST_GLOBS, asRecord, dirOf, readManifests } from './shared';
import { caretOrTildeCeiling, compareVersions, parseVersion, targetLowerBound, type Version } from './version-range';

/** Options for {@link createNoctcorePackagesCurrentRule}. */
export interface NoctcorePackagesCurrentOptions {
  /** npm scope whose packages are checked. Default `'@noctcore'`. */
  readonly scope?: string;
  /** Manifests to read. Default the root `package.json` and `apps/*`, `packages/*`, `tools/*`. */
  readonly manifestGlobs?: readonly string[];
  /**
   * Also ask the registry for each package's latest version and report a range
   * that cannot reach it. Default `false`: the check stays offline. When on, a
   * registry that cannot be reached is skipped, never reported.
   */
  readonly checkRegistry?: boolean;
  /** Registry base URL for {@link checkRegistry}. Default `'https://registry.npmjs.org'`. */
  readonly registryUrl?: string;
  /** Per-request timeout for {@link checkRegistry}, in milliseconds. Default `5000`. */
  readonly registryTimeoutMs?: number;
  /**
   * Replaces the registry read: the latest published version of a package, or
   * `null` when it is unknown. For a private registry, a cache, or tests.
   */
  readonly fetchLatest?: (name: string) => Promise<string | null>;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'noctcore-packages-current';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** One scoped range as a manifest declares it. */
interface DeclaredRange {
  readonly name: string;
  readonly range: string;
  /** Manifest path, repo-relative. */
  readonly file: string;
}

function declaredRanges(ctx: IMetaCtx, globs: readonly string[], scope: string): DeclaredRange[] {
  const prefix = `${scope}/`;
  const found: DeclaredRange[] = [];
  for (const manifest of readManifests(ctx, globs)) {
    if (!manifest.ok) continue;
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(asRecord(manifest.pkg[field]) ?? {})) {
        if (name.startsWith(prefix) && typeof range === 'string') {
          found.push({ name, range, file: manifest.file });
        }
      }
    }
  }
  return found;
}

/**
 * The version installed for `name` as the manifest at `file` resolves it, or
 * null. pnpm isolates by default, so a workspace package's dependency lands in
 * ITS node_modules; a hoisting installer puts it at the root. Walk up from the
 * manifest's directory to the root, as Node's resolution does.
 */
function installedVersion(ctx: IMetaCtx, file: string, name: string): string | null {
  let dir = file === 'package.json' ? '' : dirOf(file);
  for (;;) {
    const rel = `${dir === '' ? '' : `${dir}/`}node_modules/${name}/package.json`;
    const text = ctx.read(rel);
    if (text !== null) {
      try {
        const version = asRecord(JSON.parse(text))?.['version'];
        return typeof version === 'string' ? version : null;
      } catch {
        return null;
      }
    }
    if (dir === '') return null;
    const slash = dir.lastIndexOf('/');
    dir = slash === -1 ? '' : dir.slice(0, slash);
  }
}

/** The `[floor, ceiling)` a `^x.y.z` / `~x.y.z` range admits, or null for any other shape. */
function bounds(range: string): { floor: Version; ceiling: Version } | null {
  const ceiling = caretOrTildeCeiling(range);
  const floor = targetLowerBound(range);
  return ceiling === null || floor === null ? null : { floor, ceiling };
}

function format(version: Version): string {
  return `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`;
}

async function registryLatest(
  registryUrl: string,
  timeoutMs: number,
  name: string,
): Promise<string | null> {
  try {
    const url = `${registryUrl.replace(/\/+$/u, '')}/${name.replace('/', '%2f')}/latest`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const version = asRecord(await response.json())?.['version'];
    return typeof version === 'string' ? version : null;
  } catch {
    // Offline, a DNS failure or a timeout: the registry half is skipped, not failed.
    return null;
  }
}

/**
 * Every installed package of the scope must be a version its declared range
 * allows, and (with `checkRegistry`) every range must reach the latest
 * published version.
 *
 * A caret on a 0.x version does not cross the minor: `^0.2.0` never resolves to
 * `0.3.0`. So a package gets published, the consumer keeps resolving the old
 * minor, and nothing says so: lint stays green because the rules it wires still
 * exist, and the new ones are simply not there.
 *
 * The offline half compares the range a manifest declares with the version on
 * disk, which catches a stale install and a range that cannot reach its own
 * installed version. It cannot see a package whose latest is newer than
 * anything the range admits, because declared and installed then agree while
 * both sit a minor behind; that is the registry half.
 *
 * Registry reads are stale for a while right after a publish. A registry answer
 * older than the installed version is ignored, so a release you just installed
 * never reports against the registry's old idea of "latest".
 */
export function createNoctcorePackagesCurrentRule(
  options: NoctcorePackagesCurrentOptions = {},
): IMetaRule {
  const scope = options.scope ?? '@noctcore';
  const manifestGlobs = options.manifestGlobs ?? DEFAULT_MANIFEST_GLOBS;
  const checkRegistry = options.checkRegistry ?? false;
  const registryUrl = options.registryUrl ?? 'https://registry.npmjs.org';
  const timeoutMs = options.registryTimeoutMs ?? 5000;
  const fetchLatest =
    options.fetchLatest ?? ((name: string) => registryLatest(registryUrl, timeoutMs, name));
  const ciCritical = options.ciCritical ?? true;

  const violation = (file: string, message: string): IViolation => ({ file, rule: RULE_ID, message });

  return {
    id: RULE_ID,
    category: 'supply-chain',
    ciCritical,
    description: `An installed ${scope} package must match the range that declares it (and, with checkRegistry, that range must reach the latest published version), so a caret on 0.x cannot silently pin the repo behind a published minor.`,
    run(ctx) {
      const violations: IViolation[] = [];
      for (const { name, range, file } of declaredRanges(ctx, manifestGlobs, scope)) {
        const admitted = bounds(range);
        // `workspace:*`, a tag, a URL or an exact pin says what it means; only a
        // caret or tilde range can hide the trap.
        if (admitted === null) continue;
        const installedText = installedVersion(ctx, file, name);
        if (installedText === null) {
          violations.push(
            violation(
              file,
              `"${name}" is declared at "${range}" but is not installed for "${file}", so what actually loads cannot be checked. Run the install.`,
            ),
          );
          continue;
        }
        const installed = parseVersion(installedText);
        if (installed === null) continue;
        if (compareVersions(installed, admitted.ceiling) >= 0) {
          violations.push(
            violation(
              file,
              `"${name}" is declared "${range}" but ${installedText} is installed. A caret range on a 0.x version cannot cross the minor, so these disagree. Widen the range to "^${format(installed)}" or reinstall.`,
            ),
          );
        } else if (compareVersions(installed, admitted.floor) < 0) {
          violations.push(
            violation(
              file,
              `"${name}" is declared "${range}" but ${installedText} is installed, below the range. The install is stale: reinstall.`,
            ),
          );
        }
      }
      return violations;
    },
    async runAsync(ctx) {
      if (!checkRegistry) return [];
      const declared = declaredRanges(ctx, manifestGlobs, scope).filter((entry) => bounds(entry.range) !== null);
      const latest = new Map<string, Promise<string | null>>();
      for (const { name } of declared) {
        if (!latest.has(name)) latest.set(name, fetchLatest(name).catch(() => null));
      }
      const violations: IViolation[] = [];
      for (const { name, range, file } of declared) {
        const latestText = await latest.get(name);
        const published = latestText === null || latestText === undefined ? null : parseVersion(latestText);
        const admitted = bounds(range);
        if (published === null || admitted === null) continue;
        if (compareVersions(published, admitted.ceiling) < 0) continue;
        // The registry can lag a fresh publish; an installed version at or past
        // its "latest" means the registry is behind, not the repo.
        const installedText = installedVersion(ctx, file, name);
        const installed = installedText === null ? null : parseVersion(installedText);
        if (installed !== null && compareVersions(installed, published) >= 0) continue;
        violations.push(
          violation(
            file,
            `"${name}" is declared "${range}", which cannot reach the latest published ${latestText ?? ''}. A caret on a 0.x version does not cross the minor, so the repo stays on the old one and never sees what shipped. Widen the range to "^${format(published)}" and reinstall.`,
          ),
        );
      }
      return violations;
    },
  };
}
