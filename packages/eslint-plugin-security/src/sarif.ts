import type { ESLint } from 'eslint';

/*
 * A SARIF formatter that carries each rule's CWE and OWASP ids.
 *
 * `@microsoft/eslint-formatter-sarif` copies three fields of a rule's
 * `meta.docs` into the SARIF rule: `url`, `category` and `description`. The
 * CWE ids on this plugin's rules (`meta.docs.cwe`) are dropped there, and a
 * code scanning tool or benchmark scorer then cannot classify a finding. This
 * formatter runs that formatter and adds, to every SARIF rule whose meta
 * carries them, the tags those tools read: `security`, `external/cwe/cwe-078`
 * and `external/owasp/a03:2021`. It reads the meta of any rule, so a rule from
 * another plugin with `meta.docs.cwe` is tagged too.
 *
 * ESLint resolves a scoped `--format` name to `@scope/eslint-formatter-*`, so
 * name this file by path:
 *
 *   eslint -f ./node_modules/@noctcore/eslint-plugin-security/dist/sarif.js -o out.sarif .
 */

/** The `meta.docs` fields this formatter reads. */
interface TaxonomyDocs {
  readonly cwe?: readonly string[];
  readonly owasp?: readonly string[];
}

/** The parts of a SARIF 2.1.0 log this formatter touches; everything else passes through. */
export interface SarifLog {
  readonly runs?: readonly SarifRun[];
}

interface SarifRun {
  readonly tool?: { readonly driver?: { readonly rules?: SarifRule[] } };
}

interface SarifRule {
  readonly id: string;
  properties?: Record<string, unknown>;
}

type RulesMeta = Readonly<Record<string, { readonly docs?: unknown } | undefined>>;

/** The SARIF tags for one rule's docs, or an empty list when it carries no ids. */
export function taxonomyTags(docs: unknown): string[] {
  if (typeof docs !== 'object' || docs === null) {
    return [];
  }
  const { cwe, owasp } = docs as TaxonomyDocs;
  const tags: string[] = [];
  for (const id of cwe ?? []) {
    const match = /^CWE-(\d+)$/iu.exec(id);
    if (match?.[1] !== undefined) {
      tags.push(`external/cwe/cwe-${match[1].padStart(3, '0')}`);
    }
  }
  for (const id of owasp ?? []) {
    tags.push(`external/owasp/${id.toLowerCase()}`);
  }
  return tags.length === 0 ? tags : ['security', ...tags];
}

/**
 * Adds the CWE and OWASP tags of `rulesMeta` to the matching rules of a SARIF
 * log, keeping any tags already there. The log is changed in place and returned.
 */
export function addTaxonomyTags<T extends SarifLog>(log: T, rulesMeta: RulesMeta): T {
  for (const run of log.runs ?? []) {
    for (const rule of run.tool?.driver?.rules ?? []) {
      const tags = taxonomyTags(rulesMeta[rule.id]?.docs);
      if (tags.length === 0) {
        continue;
      }
      const properties = rule.properties ?? {};
      const existing = Array.isArray(properties.tags) ? (properties.tags as unknown[]) : [];
      properties.tags = [...new Set([...existing, ...tags])];
      rule.properties = properties;
    }
  }
  return log;
}

type BaseFormatter = (results: ESLint.LintResult[], data?: ESLint.LintResultData) => string;

const BASE_FORMATTER = '@microsoft/eslint-formatter-sarif';

async function loadBaseFormatter(): Promise<BaseFormatter> {
  let loaded: unknown;
  try {
    // A variable specifier keeps bundlers and TypeScript from resolving the
    // optional peer at build time.
    const specifier: string = BASE_FORMATTER;
    loaded = await import(specifier);
  } catch {
    throw new Error(
      `@noctcore/eslint-plugin-security/sarif needs ${BASE_FORMATTER}: install it next to the plugin.`,
    );
  }
  const candidate =
    typeof loaded === 'function' ? loaded : (loaded as { default?: unknown } | null)?.default;
  if (typeof candidate !== 'function') {
    throw new Error(`${BASE_FORMATTER} did not export a formatter function.`);
  }
  return candidate as BaseFormatter;
}

/** The ESLint formatter: SARIF 2.1.0 with CWE and OWASP tags on every rule that declares them. */
export default async function formatSarif(
  results: ESLint.LintResult[],
  data: ESLint.LintResultData,
): Promise<string> {
  const base = await loadBaseFormatter();
  const log = JSON.parse(base(results, data)) as SarifLog;
  return JSON.stringify(addTaxonomyTags(log, data.rulesMeta), null, 2);
}
