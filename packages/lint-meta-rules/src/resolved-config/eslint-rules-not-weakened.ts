import { isDeepStrictEqual } from 'node:util';

import type { IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from '../rules/glob-match';
import {
  DEFAULT_CONFIG_FILES,
  DEFAULT_PACKAGES,
  DEFAULT_PROBES,
  findConfigDirs,
  firstOptionOf,
  type ResolvedRules,
  resolveRules,
  severityOf,
} from './resolve';

/** The minimum severity a pinned rule must hold: `'warn'` (1) or `'error'` (2). */
export type PinnedSeverity = 'error' | 'warn' | 1 | 2;

/**
 * What a pinned rule must hold: a severity, or a severity plus the option keys
 * whose values must match. Only the listed keys are compared; others are free.
 */
export type PinnedRule = PinnedSeverity | readonly [PinnedSeverity, Readonly<Record<string, unknown>>];

/**
 * Options for {@link createEslintRulesNotWeakenedRule}.
 *
 * Every path is relative to the repo root the harness runs in.
 */
export interface EslintRulesNotWeakenedOptions {
  /** Rule id, for running more than one instance. Default `eslint-rules-not-weakened`. */
  readonly id?: string;
  /**
   * Rule id to the minimum it must hold in the resolved config, as a severity
   * (`'error'`) or a severity plus option keys that must match
   * (`['error', { assertionStyle: 'never' }]`). Default `{}`, which checks nothing.
   */
  readonly pinned?: Readonly<Record<string, PinnedRule>>;
  /**
   * Globs over the probe paths for probes whose resolved config may relax pinned
   * rules on purpose, such as every `.test.ts` probe; they are not checked.
   * Default `[]`.
   */
  readonly exemptProbes?: readonly string[];
  /**
   * Directories whose ESLint config is resolved, as globs (`apps/*`) or plain
   * paths (`.` for the repo root). A match is checked only when it holds one of
   * `configFiles`. Default `['.', 'apps/*', 'packages/*']`.
   */
  readonly packages?: readonly string[];
  /**
   * The file names that mark a directory as owning a flat config. Default
   * `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`.
   */
  readonly configFiles?: readonly string[];
  /**
   * Files, relative to each package, the config is resolved FOR. Resolution is
   * glob matching, so they need not exist; pick one per file shape the config
   * scopes blocks to. Default: a `.ts`, `.tsx`, `.test.ts` and `.test.tsx` file
   * under `src/`.
   */
  readonly probes?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'eslint-rules-not-weakened';
const SEVERITY_NAMES = ['off', 'warn', 'error'] as const;

/**
 * Why the resolved entry of `ruleId` in `rules` falls short of `pin`, or `null`
 * when it holds the pin.
 */
function weakness(rules: ResolvedRules, ruleId: string, pin: PinnedRule): string | null {
  if (!Object.hasOwn(rules, ruleId)) return 'is absent';
  const entry = rules[ruleId];
  const [pinSeverity, pinnedOptions] = typeof pin === 'object' ? pin : [pin, undefined];
  const pinnedSeverity = severityOf(pinSeverity);
  const severity = severityOf(entry);
  if (severity === 0) return 'is off';
  if (severity < pinnedSeverity) {
    return `resolves to "${SEVERITY_NAMES[severity]}", below the pinned "${SEVERITY_NAMES[pinnedSeverity]}"`;
  }
  if (pinnedOptions === undefined) return null;
  const resolvedOptions = firstOptionOf(entry) ?? {};
  const differing = Object.keys(pinnedOptions)
    .sort()
    .filter((key) => !isDeepStrictEqual(resolvedOptions[key], pinnedOptions[key]))
    .map((key) => {
      const resolved = Object.hasOwn(resolvedOptions, key) ? JSON.stringify(resolvedOptions[key]) : 'unset';
      return `"${key}" is ${resolved}, pinned ${JSON.stringify(pinnedOptions[key])}`;
    });
  return differing.length > 0 ? `has a different value for a pinned option (${differing.join('; ')})` : null;
}

/**
 * Pinned ESLint rules hold at least their pinned severity and options, as
 * RESOLVED.
 *
 * A contract such as "no `as` casts" is only real while the rule behind it stays
 * on at the pinned strength. A text scan of the config misses a spread preset or
 * a later override block that turns it off or relaxes its options, so this
 * resolves each package's effective flat config per probe through ESLint's
 * `calculateConfigForFile` and compares every pinned rule against it.
 *
 * Inert without `pinned`. Fails closed: a config that cannot be resolved is a
 * violation. Needs the optional `eslint` peer.
 */
export function createEslintRulesNotWeakenedRule(options: EslintRulesNotWeakenedOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const pinned = options.pinned ?? {};
  const pinnedIds = Object.keys(pinned).sort();
  const exemptProbes = options.exemptProbes ?? [];
  const packages = options.packages ?? DEFAULT_PACKAGES;
  const configFiles = options.configFiles ?? DEFAULT_CONFIG_FILES;
  const probes = options.probes ?? DEFAULT_PROBES;
  return {
    id,
    category: 'config',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every pinned ESLint rule holds at least its pinned severity and options in the RESOLVED config, so a spread preset or a later override cannot weaken it.',
    async runAsync(ctx) {
      if (pinnedIds.length === 0) return [];
      const results = await Promise.all(
        findConfigDirs(ctx, packages, configFiles).map(async ({ dir, configFile }): Promise<IViolation[]> => {
          const outcome = await resolveRules(ctx.root, dir, probes);
          if (!outcome.ok) {
            return [
              {
                file: configFile,
                rule: id,
                message: `Could not resolve the effective ESLint config for "${dir}", so its pinned rules cannot be checked (if it imports a workspace package, build that first): ${outcome.error}`,
              },
            ];
          }
          const violations: IViolation[] = [];
          outcome.rules.forEach((rules, index) => {
            const probe = outcome.resolvedProbes[index] ?? '';
            if (matchesAnyGlob(probe, exemptProbes)) return;
            for (const ruleId of pinnedIds) {
              const pin = pinned[ruleId];
              if (pin === undefined) continue;
              const why = weakness(rules, ruleId, pin);
              if (why === null) continue;
              violations.push({
                file: configFile,
                rule: id,
                message: `Rule "${ruleId}" ${why} for probe "${probe}" in "${dir}", but it is pinned to ${JSON.stringify(pin)}. This is the RESOLVED config, so a spread preset or a later override block may be the cause; restore the pinned value, or list the probe in exemptProbes if the relaxation is deliberate.`,
              });
            }
          });
          return violations;
        }),
      );
      return results.flat();
    },
  };
}
