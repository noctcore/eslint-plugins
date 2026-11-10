import type { IMetaRule, IViolation } from '@noctcore/harness';

import { dirName, isGlobPattern, joinRelative, literalPrefix, normalizeRelative } from './glob-match';
import { parseJsonc } from './jsonc';
import { asRecord, DEFAULT_SKIP_DIRS, globFiles, readSourceText } from './shared';

/**
 * Options for {@link createTsconfigIncludePathsExistRule}.
 *
 * Ported from a private monorepo whose rule walked the disk for `tsconfig*.json`
 * and skipped every glob entry; the config globs are now an option and a glob's
 * literal directory is checked too.
 */
export interface TsconfigIncludePathsExistOptions {
  /** Globs of the tsconfig files to read. Default `tsconfig.json` and `tsconfig.*.json` at any depth. */
  readonly tsconfigGlobs?: readonly string[];
  /**
   * Also require the literal directory a glob entry starts with (`src` in `src/**\/*.ts`) to exist.
   * Default `true`.
   */
  readonly checkGlobPrefixes?: boolean;
  /**
   * Skip an entry with a hidden segment (`.astro/types.d.ts`, `.storybook`): a tool that has not
   * necessarily run in this checkout generates it. Default `true`.
   */
  readonly skipHiddenEntries?: boolean;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'tsconfig-include-paths-exist';

export const DEFAULT_TSCONFIG_GLOBS: readonly string[] = ['**/tsconfig.json', '**/tsconfig.*.json'];

/** TypeScript 5.5 substitutes `${configDir}` with the config's own directory. */
const CONFIG_DIR = '${configDir}';

function stringEntries(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

function withoutConfigDir(entry: string): string {
  return entry.startsWith(CONFIG_DIR) ? `.${entry.slice(CONFIG_DIR.length)}` : entry;
}

/** The path that must exist for `entry` to match anything, or null when the entry is not checked. */
function requiredPath(entry: string, checkGlobPrefixes: boolean, skipHidden: boolean): string | null {
  const normalized = normalizeRelative(withoutConfigDir(entry));
  if (skipHidden && normalized.split('/').some((segment) => segment.startsWith('.') && segment !== '..')) {
    return null;
  }
  if (!isGlobPattern(normalized)) return normalized;
  if (!checkGlobPrefixes) return null;
  const prefix = literalPrefix(normalized);
  // `**/*.ts`, or a prefix that only climbs (`../**`): nothing narrower to check.
  return prefix === '' || prefix.split('/').every((segment) => segment === '..') ? null : prefix;
}

/** Literal `include` and `files` entries (and the literal directory of each glob) must exist. */
export function createTsconfigIncludePathsExistRule(
  options: TsconfigIncludePathsExistOptions = {},
): IMetaRule {
  const tsconfigGlobs = options.tsconfigGlobs ?? DEFAULT_TSCONFIG_GLOBS;
  const checkGlobPrefixes = options.checkGlobPrefixes ?? true;
  const skipHidden = options.skipHiddenEntries ?? true;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: RULE_ID,
    category: 'config',
    ciCritical,
    description:
      'Every literal path in a tsconfig `include` or `files` (and the directory a glob entry starts in) must exist, so a renamed folder cannot drop out of type checking in silence.',
    run(ctx) {
      const violations: IViolation[] = [];
      for (const file of globFiles((p) => ctx.glob(p), tsconfigGlobs, DEFAULT_SKIP_DIRS)) {
        const text = readSourceText((rel) => ctx.read(rel), file);
        // A tsconfig that does not parse fails tsc itself; that is not this rule's report.
        const config = text === null ? null : asRecord(parseJsonc(text));
        if (config === null) continue;
        const configDir = dirName(file);

        for (const key of ['include', 'files'] as const) {
          for (const entry of stringEntries(config[key])) {
            const required = requiredPath(entry, checkGlobPrefixes, skipHidden);
            if (required === null || ctx.exists(joinRelative(configDir, required))) continue;
            const what =
              required === normalizeRelative(withoutConfigDir(entry))
                ? `names \`${entry}\`, which does not exist`
                : `has \`${entry}\`, whose directory \`${required}\` does not exist`;
            violations.push({
              file,
              rule: RULE_ID,
              message:
                key === 'include'
                  ? `\`include\` ${what} relative to this config. tsc reports nothing for an include entry that matches nothing, so that code has silently stopped being type checked. Point the entry at where the code moved, or drop it.`
                  : `\`files\` ${what} relative to this config. tsc stops on it only when this exact config is compiled. Point the entry at where the file moved, or drop it.`,
            });
          }
        }
      }
      return violations;
    },
  };
}
