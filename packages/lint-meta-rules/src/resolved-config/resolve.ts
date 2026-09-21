import { realpathSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';

/** A resolved config's rule map: rule id to its normalised `[severity, ...options]` entry. */
export type ResolvedRules = Readonly<Record<string, unknown>>;

/** Normalise an ESLint severity (number, string or `[severity, ...options]`) to 0, 1 or 2. */
export function severityOf(entry: unknown): 0 | 1 | 2 {
  const raw = Array.isArray(entry) ? (entry as unknown[])[0] : entry;
  if (raw === 1 || raw === 'warn') return 1;
  if (raw === 2 || raw === 'error') return 2;
  return 0;
}

/** The options object a resolved rule entry carries in its first option slot, or `null`. */
export function firstOptionOf(entry: unknown): Record<string, unknown> | null {
  if (!Array.isArray(entry)) return null;
  const options: unknown = (entry as unknown[])[1];
  return typeof options === 'object' && options !== null && !Array.isArray(options)
    ? (options as Record<string, unknown>)
    : null;
}

/** Outcome of resolving one package's config for a set of probe files. */
export type ResolveOutcome =
  | { readonly ok: true; readonly rules: readonly ResolvedRules[] }
  | { readonly ok: false; readonly error: string };

/**
 * Resolve the EFFECTIVE flat config `packageDir` applies to each probe, through
 * ESLint's own `calculateConfigForFile`. That is pure glob matching, so a probe
 * need not exist on disk; what comes back is the config after every preset,
 * spread and override has been applied, which a text scan of the config file
 * cannot see.
 *
 * A fresh `ESLint` per package, rooted there, so it discovers that package's own
 * `eslint.config.*`: flat config is single-rooted and never looks downward.
 *
 * Fails closed. A probe the config merely IGNORES is fine while another probe
 * resolves, but a probe whose resolution THROWS is an error even then: a config
 * that only breaks for one file shape (a `.ts`-scoped preset naming a rule its
 * plugin lacks) would otherwise pass on the shapes that still resolve.
 */
export async function resolveRules(
  root: string,
  packageDir: string,
  probes: readonly string[],
): Promise<ResolveOutcome> {
  // Canonical, because ESLint compares a probe against its base path textually:
  // under a symlinked root (macOS `/var` -> `/private/var`) every probe would
  // read as outside the config and be reported as ignored.
  let cwd = path.resolve(root, packageDir);
  try {
    cwd = realpathSync(cwd);
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  const eslint = new ESLint({ cwd, errorOnUnmatchedPattern: false });
  const rules: ResolvedRules[] = [];
  const ignored: string[] = [];

  for (const probe of probes) {
    let config: { rules?: ResolvedRules } | undefined;
    try {
      config = (await eslint.calculateConfigForFile(path.join(cwd, probe))) as
        | { rules?: ResolvedRules }
        | undefined;
    } catch (error) {
      return { ok: false, error: `resolving "${probe}": ${String(error)}` };
    }
    // `undefined` means the config ignores the probe, or no block matches it.
    if (config === undefined) ignored.push(probe);
    else rules.push(config.rules ?? {});
  }

  if (rules.length > 0) return { ok: true, rules };
  return {
    ok: false,
    error:
      probes.length === 0
        ? 'no probe files are configured'
        : `every probe (${ignored.map((probe) => `"${probe}"`).join(', ')}) is ignored by the config or matched by no block`,
  };
}
