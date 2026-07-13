import type { IMetaRule, IViolation } from '@noctcore/harness';

import { baseName } from './shared';

/**
 * Options for {@link createUiPrimitiveShapeRule}.
 *
 * De-projected from nightcore, which hardcoded `apps/web/src/components/ui`, the
 * `test`/`stories` roles and the `.tsx` extension. All are options.
 */
export interface UiPrimitiveShapeOptions {
  /** The primitives root. Default `'apps/web/src/components/ui'`. */
  readonly uiRoot?: string;
  /** Barrel file that marks a folder-primitive. Default `'index.ts'`. */
  readonly barrelFile?: string;
  /** Proof-of-behavior sibling roles a folder-primitive must ship. Default `['test', 'stories']`. */
  readonly roles?: readonly string[];
  /** Extension of primitive and proof files. Default `'.tsx'`. */
  readonly extension?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * The primitives root is the one folder exempt from folder-per-component: flat
 * single files are allowed for presentational primitives. But once a primitive
 * graduates to a folder (its own dir + barrel) it must ship the same
 * proof-of-behavior siblings as any component: `<Name>.<role><ext>` for each
 * role. Also flags the hybrid shape: a flat `<Name><ext>` at the root that
 * already carries a sibling proof file — those belong inside `<Name>/`.
 */
export function createUiPrimitiveShapeRule(options: UiPrimitiveShapeOptions = {}): IMetaRule {
  const uiRoot = options.uiRoot ?? 'apps/web/src/components/ui';
  const barrelFile = options.barrelFile ?? 'index.ts';
  const roles = options.roles ?? ['test', 'stories'];
  const extension = options.extension ?? '.tsx';
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'ui-primitive-shape',
    category: 'source-text',
    ciCritical,
    description: `A folder primitive under the ui root must ship its proof siblings (${roles.join(', ')}); a flat primitive must not carry sibling proof files at the root.`,
    run(ctx) {
      const violations: IViolation[] = [];
      // Folder primitives: require each proof sibling.
      for (const barrel of ctx.glob(`${uiRoot}/*/${barrelFile}`)) {
        const dir = barrel.replace(new RegExp(`/${barrelFile}$`), '');
        const name = baseName(dir);
        for (const role of roles) {
          const rel = `${dir}/${name}.${role}${extension}`;
          if (!ctx.exists(rel)) {
            violations.push({
              file: dir,
              rule: 'ui-primitive-shape',
              message: `ui folder-primitive '${name}' is missing ${name}.${role}${extension}. A ui primitive complex enough to be a folder must ship its proof siblings (or stay a flat presentational file).`,
            });
          }
        }
      }
      // Flat primitives: must not carry sibling proof files at the root.
      for (const flat of ctx.glob(`${uiRoot}/[A-Z]*${extension}`)) {
        const name = baseName(flat).replace(new RegExp(`${extension.replace(/\./g, '\\.')}$`), '');
        for (const role of roles) {
          const sibling = `${uiRoot}/${name}.${role}${extension}`;
          if (ctx.exists(sibling)) {
            violations.push({
              file: flat,
              rule: 'ui-primitive-shape',
              message: `ui flat primitive '${name}${extension}' has a sibling ${name}.${role}${extension} at the ui root — move both into a '${name}/' folder with ${barrelFile}.`,
            });
          }
        }
      }
      return violations;
    },
  };
}
