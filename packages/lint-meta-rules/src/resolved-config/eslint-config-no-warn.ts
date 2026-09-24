import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { stripTrailingSlashes } from '../rules/shared';
import { resolveRules, severityOf } from './resolve';

/**
 * Options for {@link createEslintConfigNoWarnRule}.
 *
 * Every path is relative to the repo root the harness runs in.
 */
export interface EslintConfigNoWarnOptions {
  /** Rule id, for running more than one instance. Default `eslint-config-no-warn`. */
  readonly id?: string;
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

const DEFAULT_ID = 'eslint-config-no-warn';
const DEFAULT_PACKAGES = ['.', 'apps/*', 'packages/*'];
const DEFAULT_CONFIG_FILES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];
const DEFAULT_PROBES = [
  'src/__lint_meta_probe__.ts',
  'src/__lint_meta_probe__.tsx',
  'src/__lint_meta_probe__.test.ts',
  'src/__lint_meta_probe__.test.tsx',
];

/**
 * Every directory matched by `packages` that owns a config, with that config's
 * file. Globs the config file itself (`<pattern>/eslint.config.js`) rather than the
 * directory, so a match never depends on whether a glob returns directories.
 */
function findConfigDirs(
  ctx: IMetaCtx,
  packages: readonly string[],
  configFiles: readonly string[],
): { dir: string; configFile: string }[] {
  const byDir = new Map<string, string>();
  for (const pattern of packages) {
    const base = stripTrailingSlashes(pattern);
    for (const name of configFiles) {
      // The harness glob drops a bare `.`, so the root is checked literally.
      const matches =
        base === '.' || base === '' ? (ctx.exists(name) ? [name] : []) : ctx.glob(`${base}/${name}`);
      for (const configFile of matches) {
        const slash = configFile.lastIndexOf('/');
        const dir = slash === -1 ? '.' : configFile.slice(0, slash);
        // `configFiles` order decides which file names a directory owning two.
        if (!byDir.has(dir)) byDir.set(dir, configFile);
      }
    }
  }
  return [...byDir]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, configFile]) => ({ dir, configFile }));
}

/**
 * ESLint severities must be `error` or `off`, never `warn`, as RESOLVED.
 *
 * Resolves each package's effective flat config through ESLint's
 * `calculateConfigForFile` and reports every rule that ends up at `warn`. That is
 * the point of the rule: a preset spread into the config (a `recommended` block
 * that ships rules at `warn`) injects the severity without a `"warn"` literal in
 * any file the project owns, so a text scan such as `no-warn-severity` passes it.
 *
 * Fails closed: a config that cannot be resolved at all is a violation, never a
 * silent pass. Needs the optional `eslint` peer.
 */
export function createEslintConfigNoWarnRule(options: EslintConfigNoWarnOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const packages = options.packages ?? DEFAULT_PACKAGES;
  const configFiles = options.configFiles ?? DEFAULT_CONFIG_FILES;
  const probes = options.probes ?? DEFAULT_PROBES;
  return {
    id,
    category: 'config',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every rule in the RESOLVED ESLint config is "error" or "off", never "warn", including severities a spread preset injects.',
    async runAsync(ctx) {
      const results = await Promise.all(
        findConfigDirs(ctx, packages, configFiles).map(async ({ dir, configFile }) => {
          const outcome = await resolveRules(ctx.root, dir, probes);
          if (!outcome.ok) {
            return [
              {
                file: configFile,
                rule: id,
                message: `Could not resolve the effective ESLint config for "${dir}", so its severities cannot be checked (if it imports a workspace package, build that first): ${outcome.error}`,
              },
            ];
          }
          const warned = new Set<string>();
          for (const rules of outcome.rules) {
            for (const [ruleId, entry] of Object.entries(rules)) {
              if (severityOf(entry) === 1) warned.add(ruleId);
            }
          }
          return [...warned].sort().map(
            (ruleId): IViolation => ({
              file: configFile,
              rule: id,
              message: `Rule "${ruleId}" resolves to "warn" in "${dir}". ESLint severities must be "error" or "off", never "warn" (this is the RESOLVED severity, so it may come from a spread preset rather than a literal in the config file). Override it explicitly.`,
            }),
          );
        }),
      );
      return results.flat();
    },
  };
}
