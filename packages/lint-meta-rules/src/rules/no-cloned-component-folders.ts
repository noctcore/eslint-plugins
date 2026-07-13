import type { IMetaRule, IViolation } from '@noctcore/harness';

/**
 * Options for {@link createNoClonedComponentFoldersRule}.
 *
 * De-projected from nightcore, which hardcoded `apps/web/src/components`, the
 * `ui`/`app` excluded features, and a fixed `ALLOWED_CLONES` allowlist. The
 * components root, barrel marker, excluded features, allowlist and the
 * shared-destination hint are all options.
 */
export interface NoClonedComponentFoldersOptions {
  /** Root under which `<feature>/<Component>/` folders live. Default `'apps/web/src/components'`. */
  readonly componentsRoot?: string;
  /** Barrel file that marks a component folder. Default `'index.ts'`. */
  readonly barrelFile?: string;
  /** Feature folders whose contents are not feature components. Default `['ui', 'app']`. */
  readonly excludedFeatures?: readonly string[];
  /** Component names allowed to be cloned across features (a shrinking allowlist). Default `[]`. */
  readonly allowedClones?: readonly string[];
  /** Where a shared surface should be hoisted, used in the message. Default `'components/ui'`. */
  readonly sharedDest?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * Same-named component folders across features are how sibling drift happens: a
 * component cloned into a second feature diverges silently. A shared surface
 * belongs in the shared destination; a genuinely different one deserves a name
 * that says so. The allowlist freezes today's clone groups and only shrinks —
 * an allowlist entry with no remaining clone group is itself a violation.
 */
export function createNoClonedComponentFoldersRule(
  options: NoClonedComponentFoldersOptions = {},
): IMetaRule {
  const componentsRoot = options.componentsRoot ?? 'apps/web/src/components';
  const barrelFile = options.barrelFile ?? 'index.ts';
  const excludedFeatures = new Set(options.excludedFeatures ?? ['ui', 'app']);
  const allowedClones = new Set(options.allowedClones ?? []);
  const sharedDest = options.sharedDest ?? 'components/ui';
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'no-cloned-component-folders',
    category: 'source-text',
    ciCritical,
    description:
      'A component folder name may exist under only ONE feature. Shared surfaces are hoisted; divergent ones get a divergent name. Today’s clones are frozen in a shrinking allowlist.',
    run(ctx) {
      const violations: IViolation[] = [];

      // <feature>/<Name>/<barrelFile> marks a component folder.
      const byName = new Map<string, string[]>();
      for (const rel of ctx.glob(`${componentsRoot}/*/*/${barrelFile}`)) {
        const segments = rel.split('/');
        const name = segments[segments.length - 2];
        const feature = segments[segments.length - 3];
        if (name === undefined || feature === undefined) continue;
        if (excludedFeatures.has(feature)) continue;
        const features = byName.get(name) ?? [];
        features.push(feature);
        byName.set(name, features);
      }

      for (const [name, features] of byName) {
        if (features.length < 2 || allowedClones.has(name)) continue;
        const sorted = [...features].sort();
        violations.push({
          file: `${componentsRoot}/{${sorted.join(',')}}/${name}`,
          rule: 'no-cloned-component-folders',
          message: `Component folder '${name}' is cloned across ${features.length} features (${sorted.join(', ')}) — clone drift in the making. Hoist it to ${sharedDest} or rename to reflect divergent semantics.`,
        });
      }

      // Self-tightening: an allowlist entry with no clone group left is stale.
      for (const name of allowedClones) {
        const features = byName.get(name) ?? [];
        if (features.length < 2) {
          violations.push({
            file: `${componentsRoot}/*/${name}`,
            rule: 'no-cloned-component-folders',
            message: `Allowlist entry '${name}' is stale — the clone group no longer exists. Remove it from allowedClones (the allowlist only shrinks).`,
          });
        }
      }

      return violations;
    },
  };
}
