import type { IMetaRule, IViolation } from '@noctcore/harness';

import { baseName, dirOf } from './shared';

/**
 * Options for {@link createPackageShapeRule}.
 *
 * De-projected from nightcore, which hardcoded the `@nightcore` scope, the
 * `packages/*` vs `apps/*` split, the `src/index.ts` barrel and the `dist/`
 * output marker. Every anchor is now an option. `libraryGlobs` packages get the
 * full name + barrel + build-output checks; `appGlobs` packages (deployable
 * surfaces) get the name check only.
 */
export interface PackageShapeOptions {
  /** npm scope every workspace is named under (`<scope>/<dir>`). Default `'@nightcore'`. */
  readonly scope?: string;
  /** `package.json` globs for library packages (full checks). Default `['packages/*\/package.json']`. */
  readonly libraryGlobs?: readonly string[];
  /** `package.json` globs for app/surface packages (name check only). Default `['apps/*\/package.json']`. */
  readonly appGlobs?: readonly string[];
  /** Directory → exact package name overrides for intentionally off-scope packages. Default `{}`. */
  readonly externalNames?: Readonly<Record<string, string>>;
  /** Barrel each library package must expose, relative to its dir. Default `'src/index.ts'`. */
  readonly barrelPath?: string;
  /** Substring the build-output fields must contain. Default `'dist/'`. */
  readonly distMarker?: string;
  /** `package.json` string fields that must point at built output. Default `['main','module','types']`. */
  readonly distFields?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * Package-shape invariant. Every workspace is named `<scope>/<dir>` matching its
 * folder. Library packages additionally expose a single barrel and point their
 * `main`/`module`/`types`/`exports` at the built output. App packages are
 * deployable surfaces — only the name match applies to them.
 */
export function createPackageShapeRule(options: PackageShapeOptions = {}): IMetaRule {
  const scope = options.scope ?? '@nightcore';
  const libraryGlobs = options.libraryGlobs ?? ['packages/*/package.json'];
  const appGlobs = options.appGlobs ?? ['apps/*/package.json'];
  const externalNames = options.externalNames ?? {};
  const barrelPath = options.barrelPath ?? 'src/index.ts';
  const distMarker = options.distMarker ?? 'dist/';
  const distFields = options.distFields ?? ['main', 'module', 'types'];
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'package-shape',
    category: 'config',
    ciCritical,
    description:
      'Every workspace is named <scope>/<dir>; library packages expose a barrel and point main/module/types/exports at the built output.',
    run(ctx) {
      const violations: IViolation[] = [];
      const groups = [
        { globs: libraryGlobs, library: true },
        { globs: appGlobs, library: false },
      ];
      for (const group of groups) {
        const rels = group.globs.flatMap((g) => ctx.glob(g));
        for (const rel of rels) {
          const raw = ctx.read(rel);
          if (raw === null) continue;
          let pkg: Record<string, unknown>;
          try {
            pkg = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            violations.push({ file: rel, rule: 'package-shape', message: 'package.json is not valid JSON.' });
            continue;
          }
          const dir = dirOf(rel);
          const expected = externalNames[dir] ?? `${scope}/${baseName(dir)}`;
          if (pkg.name !== expected) {
            violations.push({
              file: rel,
              rule: 'package-shape',
              message: `Workspace name '${String(pkg.name)}' must equal '${expected}' (the directory it lives in).`,
            });
          }
          // Build-output checks apply only to library packages.
          if (!group.library) continue;
          if (!ctx.exists(`${dir}/${barrelPath}`)) {
            violations.push({
              file: rel,
              rule: 'package-shape',
              message: `Library package must expose a single barrel at ${dir}/${barrelPath}.`,
            });
          }
          for (const field of distFields) {
            const val = pkg[field];
            if (typeof val === 'string' && !val.includes(distMarker)) {
              violations.push({
                file: rel,
                rule: 'package-shape',
                message: `package.json "${field}" ('${val}') must point at the built output containing '${distMarker}'.`,
              });
            }
          }
          if (pkg.exports && !JSON.stringify(pkg.exports).includes(distMarker)) {
            violations.push({
              file: rel,
              rule: 'package-shape',
              message: `package.json "exports" must reference the built output containing '${distMarker}'.`,
            });
          }
        }
      }
      return violations;
    },
  };
}
