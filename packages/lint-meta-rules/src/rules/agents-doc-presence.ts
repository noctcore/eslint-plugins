import type { IMetaRule, IViolation } from '@noctcore/harness';

import { dirOf } from './shared';

/**
 * Options for {@link createAgentsDocPresenceRule}.
 *
 * De-projected from nightcore, which hardcoded `AGENTS.md`, the root/apps/packages
 * layout and a fixed leaf opt-out set. The doc filename, which dirs require it,
 * and the opt-out list are all options.
 */
export interface AgentsDocPresenceOptions {
  /** The agent-contract filename required in each location. Default `'AGENTS.md'`. */
  readonly docFile?: string;
  /** Whether the repo root must carry the doc. Default `true`. */
  readonly requireAtRoot?: boolean;
  /** `package.json` globs for deployable surfaces (all require the doc). Default `['apps/*\/package.json']`. */
  readonly surfaceGlobs?: readonly string[];
  /** `package.json` globs for library packages (require the doc unless opted out). Default `['packages/*\/package.json']`. */
  readonly packageGlobs?: readonly string[];
  /** Package directories exempt from the requirement. Default `[]`. */
  readonly optOut?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

/**
 * Agent-contract coverage. Every deployable surface and public boundary must
 * ship the agent-contract doc so an agent editing it reads the guardrails first.
 * Trivial leaf packages may be opted out; a NEW package must ship the doc by
 * default.
 */
export function createAgentsDocPresenceRule(
  options: AgentsDocPresenceOptions = {},
): IMetaRule {
  const docFile = options.docFile ?? 'AGENTS.md';
  const requireAtRoot = options.requireAtRoot ?? true;
  const surfaceGlobs = options.surfaceGlobs ?? ['apps/*/package.json'];
  const packageGlobs = options.packageGlobs ?? ['packages/*/package.json'];
  const optOut = new Set(options.optOut ?? []);
  const ciCritical = options.ciCritical ?? true;

  return {
    id: 'agents-doc-presence',
    category: 'source-text',
    ciCritical,
    description: `${docFile} must exist at the repo root, every surface, and every non-opted-out package.`,
    run(ctx) {
      const violations: IViolation[] = [];
      const requireDoc = (dir: string, label: string) => {
        const rel = dir === '' ? docFile : `${dir}/${docFile}`;
        if (!ctx.exists(rel)) {
          violations.push({
            file: rel,
            rule: 'agents-doc-presence',
            message: `${label} is missing an ${docFile} agent contract. Add one (or, for a trivial leaf package, add it to the opt-out list with justification).`,
          });
        }
      };

      if (requireAtRoot) requireDoc('', 'The repo root');
      for (const pkg of surfaceGlobs.flatMap((g) => ctx.glob(g))) {
        requireDoc(dirOf(pkg), 'Surface');
      }
      for (const pkg of packageGlobs.flatMap((g) => ctx.glob(g))) {
        const dir = dirOf(pkg);
        if (optOut.has(dir)) continue;
        requireDoc(dir, 'Package');
      }
      return violations;
    },
  };
}
