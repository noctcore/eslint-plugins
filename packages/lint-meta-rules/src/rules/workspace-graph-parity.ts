import type { IMetaRule, IViolation } from '@noctcore/harness';

import { baseName, dirOf, escapeRegExp } from './shared';

/**
 * Options for {@link createWorkspaceGraphParityRule}.
 *
 * De-projected from nightcore, which hardcoded the `@nightcore` scope and a
 * `src` source directory: both are options. All scope-sensitive regexes are
 * rebuilt from the configured `scope`.
 */
export interface WorkspaceGraphParityOptions {
  /** npm scope of workspace packages. Default `'@nightcore'`. */
  readonly scope?: string;
  /** `package.json` globs to enforce parity for. Default packages + apps. */
  readonly packageGlobs?: readonly string[];
  /** Source directory (relative to each package) to scan for imports. Default `'src'`. */
  readonly srcDir?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * Workspace dependency-graph parity. For each workspace package:
 *  (a) every `<scope>/<pkg>` imported in the source dir must be declared as a
 *      `workspace:*` dependency in package.json, and
 *  (b) its tsconfig.json `references` must mirror exactly those workspace deps.
 * So a new cross-package edge can never be half-wired (imported but undeclared,
 * or declared but missing from the TS project graph).
 */
export function createWorkspaceGraphParityRule(
  options: WorkspaceGraphParityOptions = {},
): IMetaRule {
  const scope = options.scope ?? '@nightcore';
  const packageGlobs = options.packageGlobs ?? ['packages/*/package.json', 'apps/*/package.json'];
  const srcDir = options.srcDir ?? 'src';
  const ciCritical = options.ciCritical ?? true;
  const esc = escapeRegExp(scope);

  return {
    id: 'workspace-graph-parity',
    category: 'config',
    ciCritical,
    description:
      'Imported <scope>/* specifiers must be declared workspace:* deps, and tsconfig references must mirror those deps.',
    run(ctx) {
      const violations: IViolation[] = [];
      const declaredRe = new RegExp(`"(${esc}\\/[a-z0-9-]+)"\\s*:\\s*"workspace:[^"]*"`, 'g');
      const importRe = new RegExp(`from\\s+['"](${esc}\\/[a-z0-9-]+)`, 'g');

      for (const rel of packageGlobs.flatMap((g) => ctx.glob(g))) {
        const raw = ctx.read(rel);
        if (raw === null) continue;
        const dir = dirOf(rel);
        const self = `${scope}/${baseName(dir)}`;

        const declared = new Set(
          Array.from(raw.matchAll(declaredRe), (m) => m[1]).filter(
            (s): s is string => s !== undefined,
          ),
        );

        const imported = new Set<string>();
        const srcFiles = [
          ...ctx.glob(`${dir}/${srcDir}/**/*.ts`),
          ...ctx.glob(`${dir}/${srcDir}/**/*.tsx`),
        ];
        for (const f of srcFiles) {
          if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue;
          const body = ctx.read(f) ?? '';
          for (const m of body.matchAll(importRe)) {
            const spec = m[1];
            if (spec !== undefined && spec !== self) imported.add(spec);
          }
        }

        // (a) imported subset of declared.
        for (const spec of imported) {
          if (!declared.has(spec)) {
            violations.push({
              file: rel,
              rule: 'workspace-graph-parity',
              message: `${self} imports ${spec} but does not declare it as a "workspace:*" dependency. Add it to package.json.`,
            });
          }
        }

        // (b) tsconfig references mirror declared deps.
        const tsconfig = ctx.read(`${dir}/tsconfig.json`);
        if (tsconfig !== null) {
          const refDirs = new Set(
            Array.from(tsconfig.matchAll(/"path"\s*:\s*"([^"]+)"/g), (m) => {
              const parts = (m[1] ?? '').split('/').filter(Boolean);
              return `${scope}/${parts[parts.length - 1] ?? ''}`;
            }),
          );
          for (const dep of declared) {
            if (!refDirs.has(dep)) {
              violations.push({
                file: `${dir}/tsconfig.json`,
                rule: 'workspace-graph-parity',
                message: `tsconfig "references" is missing ${dep}, a declared workspace:* dependency. References must mirror deps.`,
              });
            }
          }
          for (const ref of refDirs) {
            if (!declared.has(ref)) {
              violations.push({
                file: `${dir}/tsconfig.json`,
                rule: 'workspace-graph-parity',
                message: `tsconfig references ${ref} but it is not a declared workspace:* dependency. References must mirror deps.`,
              });
            }
          }
        }
      }
      return violations;
    },
  };
}
