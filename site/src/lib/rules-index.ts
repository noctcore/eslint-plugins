/**
 * The public, machine-readable rule index served at `/rules.json`, and the
 * `llms.txt` that points at it. Both are derived from the generated catalog,
 * so they cannot disagree with the all-rules page or any package table.
 *
 * This shape is a public contract: consumers fetch it instead of scraping the
 * site. Add fields freely; renaming or removing one is a breaking change and
 * bumps `schemaVersion`. The all-rules page documents the fields for readers,
 * and scripts/check-build.ts asserts the emitted file has exactly one entry
 * per rule doc and that every `url` resolves to an emitted page.
 */
import { packages, type CatalogPackage, type CatalogRule } from './catalog';
import { deprecatedRulesSection } from './deprecations';

export const RULES_INDEX_SCHEMA_VERSION = 1;

export interface RulesIndexPackage {
  /** npm package name, e.g. `@noctcore/eslint-plugin-react`. */
  readonly name: string;
  /** Short name used in routes and rule ids: `react`, ..., `lint-meta-rules`. */
  readonly short: string;
  readonly version: string;
  readonly description: string;
  readonly kind: 'eslint-plugin' | 'lint-meta';
  /** Flat-config namespace (`noctcore-react`); null for the lint-meta catalog. */
  readonly namespace: string | null;
  /** The package's page on this site. */
  readonly url: string;
}

export interface RulesIndexRule {
  /** The id a config or a report uses: `noctcore-react/no-prop-drilling`, or the bare lint-meta id. */
  readonly id: string;
  /** Rule name without the namespace. */
  readonly name: string;
  /** npm name of the package that exports the rule. */
  readonly package: string;
  /** What runs it: ESLint, or the `@noctcore/harness` lint-meta runner. */
  readonly runner: 'eslint' | 'harness';
  readonly description: string;
  /** The rendered rule doc on this site. */
  readonly url: string;
  /** Severity in the package's `recommended` preset; null when the preset does not list it, or for lint-meta rules. */
  readonly recommended: 'error' | 'off' | null;
  readonly fixable: boolean;
  readonly hasSuggestions: boolean;
  /** Whether the rule needs a type-checked program. */
  readonly typeInfo: 'required' | 'optional' | 'none';
  /** Whether the rule is deprecated. A deprecated rule still works but is never in a preset. */
  readonly deprecated: boolean;
  /** Ids of the rules that replace a deprecated one; empty when there is none, or it is not deprecated. */
  readonly replacedBy: readonly string[];
  /** The package version that deprecated the rule, when its `meta` says. */
  readonly deprecatedSince: string | null;
  /** lint-meta only. */
  readonly category?: string;
  readonly ciCritical?: boolean;
  readonly factory?: string;
  readonly entry?: string;
}

export interface RulesIndex {
  readonly schemaVersion: number;
  /** ISO timestamp of the build that emitted this file. */
  readonly generatedAt: string;
  readonly site: string;
  /** The human-readable all-rules page. */
  readonly rulesPage: string;
  readonly count: number;
  readonly packages: readonly RulesIndexPackage[];
  readonly rules: readonly RulesIndexRule[];
}

/** Absolute URL of a site-relative route, from Astro's `site` and `base`. */
export function absoluteUrl(route: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}${route.replace(/^\//, '')}`, import.meta.env.SITE).href;
}

function packageEntry(pkg: CatalogPackage): RulesIndexPackage {
  return {
    name: pkg.npmName,
    short: pkg.short,
    version: pkg.version,
    description: pkg.description,
    kind: pkg.kind as RulesIndexPackage['kind'],
    namespace: pkg.namespace,
    url: absoluteUrl(`packages/${pkg.short}/`),
  };
}

function ruleEntry(pkg: CatalogPackage, rule: CatalogRule): RulesIndexRule {
  const recommended = rule.recommended === 'error' || rule.recommended === 'off' ? rule.recommended : null;
  const entry: RulesIndexRule = {
    id: rule.id,
    name: rule.name,
    package: pkg.npmName,
    runner: pkg.kind === 'eslint-plugin' ? 'eslint' : 'harness',
    description: rule.description,
    url: absoluteUrl(rule.route),
    recommended,
    fixable: rule.fixable,
    hasSuggestions: rule.hasSuggestions,
    typeInfo: rule.typeInfo as RulesIndexRule['typeInfo'],
    deprecated: rule.deprecated,
    // The catalog is JSON, so with no deprecated rule these infer as `never[]` and `null`.
    replacedBy: rule.replacedBy as readonly string[],
    deprecatedSince: rule.deprecatedSince as string | null,
  };
  if (pkg.kind !== 'lint-meta') return entry;
  const meta = rule as CatalogRule & { category?: string; ciCritical?: boolean; factory?: string; entry?: string };
  return { ...entry, category: meta.category, ciCritical: meta.ciCritical, factory: meta.factory, entry: meta.entry };
}

export function buildRulesIndex(generatedAt: Date = new Date()): RulesIndex {
  const rules = packages.flatMap((pkg) => pkg.rules.map((rule) => ruleEntry(pkg, rule)));
  return {
    schemaVersion: RULES_INDEX_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    site: absoluteUrl(''),
    rulesPage: absoluteUrl('rules/'),
    count: rules.length,
    packages: packages.map(packageEntry),
    rules,
  };
}

/**
 * `llms.txt` per https://llmstxt.org: an H1, a blockquote summary, prose, then
 * H2 sections of `- [name](url): note` lists. Kept short on purpose; the JSON
 * index and the all-rules page carry the detail.
 */
export function buildLlmsTxt(index: RulesIndex): string {
  const plugins = index.packages.filter((pkg) => pkg.kind === 'eslint-plugin');
  const lines = [
    '# noctcore ESLint plugins',
    '',
    `> ${plugins.length} focused ESLint plugins and one lint-meta rule catalog, ${index.count} rules in all, for architecture and correctness conventions generic linters cannot see. Every preset severity is error or off; there are no warnings.`,
    '',
    'Rule ids are `noctcore-<plugin>/<rule>`. Every rule has one page with its options and Incorrect and Correct examples that run in that package\'s test suite. The rule docs are the source of truth; nothing on the site restates them.',
    '',
    '## Rules',
    '',
    `- [All rules](${index.rulesPage}): one row per rule with the id, what it reports, preset severity and whether it needs type information`,
    `- [rules.json](${absoluteUrl('rules.json')}): the same index as JSON, one entry per rule with its docs URL, package, preset severity, fixability, type-information needs and deprecation (\`deprecated\`, \`replacedBy\`)`,
    '',
    ...deprecatedRulesSection(index.rules),
    '## Guides',
    '',
    `- [Getting started](${absoluteUrl('getting-started/')}): install a plugin, enable its preset, configure the rules that need to know your project`,
    `- [Adopting in an existing codebase](${absoluteUrl('adopting/')}): enable the preset, switch flooding rules off, re-enable them per directory, never warn`,
    '',
    '## Packages',
    '',
    ...index.packages.map((pkg) => `- [${pkg.name}](${pkg.url}): ${pkg.description}`),
    '',
  ];
  return lines.join('\n');
}
