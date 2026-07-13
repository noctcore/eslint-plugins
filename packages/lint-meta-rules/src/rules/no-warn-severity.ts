import type { IMetaRule, IViolation } from '@noctcore/harness';

/**
 * Options for {@link createNoWarnSeverityRule}.
 *
 * De-projected from nightcore, which hardcoded `eslint.config.mjs`: the set of
 * flat-config files to scan is now the `configFiles` option (each is scanned if
 * it exists), so the rule fits whatever flat-config filename a repo uses.
 */
export interface NoWarnSeverityOptions {
  /** Flat-config files to scan; each is read only if present. */
  readonly configFiles?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_CONFIG_FILES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];

/**
 * Severity is `error` or `off`, never `warn`. Agents iterate by reading CI
 * failures; a warning is a silent miss an agent will not act on. This scans the
 * flat-config text (line comments stripped) for any `'warn'` / `"warn"` literal.
 */
export function createNoWarnSeverityRule(options: NoWarnSeverityOptions = {}): IMetaRule {
  const configFiles = options.configFiles ?? DEFAULT_CONFIG_FILES;
  const ciCritical = options.ciCritical ?? true;
  return {
    id: 'no-warn-severity',
    category: 'config',
    ciCritical,
    description:
      "ESLint severity is 'error' or 'off', never 'warn'. A rule that matters is an error; a failure is fixed, not silenced.",
    run(ctx) {
      const violations: IViolation[] = [];
      for (const configFile of configFiles) {
        const config = ctx.read(configFile);
        if (config === null) continue;
        config.split(/\r?\n/).forEach((line, i) => {
          const code = line.replace(/\r$/, '').replace(/\/\/.*$/, '');
          if (/['"]warn['"]/.test(code)) {
            violations.push({
              file: configFile,
              rule: 'no-warn-severity',
              message: `Line ${i + 1}: ESLint 'warn' severity is forbidden — use 'error' or 'off'.`,
              line: i + 1,
            });
          }
        });
      }
      return violations;
    },
  };
}
