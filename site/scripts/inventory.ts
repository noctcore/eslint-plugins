/**
 * The single inventory of every rule and every rule doc in this repo.
 *
 * Rules are read from what each package actually EXPORTS, not from a directory
 * listing: the exported surface is what a consumer gets,
 * and 9 of the lint-meta rules live outside `src/rules/` behind their own entry
 * points (`/i18n`, `/prisma`, `/resolved-config`, `/session`, `/trpc`). A listing of
 * `packages/*\/src/rules/*.ts` finds 104 and is blind to those 9.
 *
 * Docs are read from `packages/*\/docs/rules/*.md`, the files that ship in each
 * tarball and that the site renders.
 *
 * The sync step, the parity guard and the post-build link check all go through
 * this module, so they cannot disagree about what exists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PACKAGES_DIR = join(REPO_ROOT, 'packages');
export const REPO_URL = 'https://github.com/noctcore/eslint-plugins';

/** Site origin and base, per the project Pages URL of `noctcore/eslint-plugins`. */
export const SITE_ORIGIN = 'https://noctcore.github.io';
export const SITE_BASE = '/eslint-plugins';

/** The ESLint plugins, by short name (the part after `eslint-plugin-`). */
export const PLUGIN_SHORT_NAMES = [
  'react',
  'architecture',
  'monorepo',
  'contracts',
  'code-quality',
  'async-safety',
  'observability',
  'security',
  'prisma',
  'rsc',
  'llm',
] as const;

export const LINT_META = 'lint-meta-rules';

/** lint-meta-rules entry points other than the main catalog. */
const LINT_META_SUBPATHS = ['i18n', 'prisma', 'resolved-config', 'session', 'trpc'] as const;

export type TypeInfo = 'required' | 'optional' | 'none';

export interface RuleEntry {
  /** Rule name, e.g. `no-prop-drilling`. */
  readonly name: string;
  /** Fully qualified id as a user writes it, e.g. `noctcore-react/no-prop-drilling`. */
  readonly id: string;
  readonly description: string;
  /** Severity in the `recommended` preset, or null when the preset does not list it. */
  readonly recommended: string | null;
  readonly fixable: boolean;
  readonly hasSuggestions: boolean;
  readonly typeInfo: TypeInfo;
  /**
   * `meta.docs.requiresOptions`: the rule does nothing useful until the
   * consumer passes options (a scope, a model registry, an action-client list).
   */
  readonly requiresOptions: boolean;
  /**
   * Whether the rule takes options: a non-empty `meta.schema` for an ESLint
   * rule, always for a lint-meta factory. The rule doc has an `## Options`
   * section exactly when this is true.
   */
  readonly hasOptions: boolean;
  /** `meta.deprecated`, in either the boolean or the object form. */
  readonly deprecated: boolean;
  /**
   * Fully qualified ids of the replacement rules, from `meta.deprecated.replacedBy`
   * and the older `meta.replacedBy`, deduplicated.
   */
  readonly replacedBy: readonly string[];
  /** `meta.deprecated.deprecatedSince`: the package version that deprecated the rule. */
  readonly deprecatedSince: string | null;
  /** `meta.deprecated.message`: why, or how to move off it. */
  readonly deprecationMessage: string | null;
  /** `meta.docs.url` as baked into the built rule; null for lint-meta rules. */
  readonly docsUrl: string | null;
  /** lint-meta only: rule category and whether a violation fails CI by default. */
  readonly category?: string;
  readonly ciCritical?: boolean;
  /** lint-meta only: the factory export and the entry point that exposes it. */
  readonly factory?: string;
  readonly entry?: string;
}

export interface PackageEntry {
  /** Short name used in routes: `react`, ..., `lint-meta-rules`. */
  readonly short: string;
  readonly npmName: string;
  readonly kind: 'eslint-plugin' | 'lint-meta';
  /** Flat-config namespace (`noctcore-react`), null for lint-meta. */
  readonly namespace: string | null;
  readonly version: string;
  readonly description: string;
  readonly dir: string;
  readonly rules: readonly RuleEntry[];
}

export function packageDirOf(short: string): string {
  return join(PACKAGES_DIR, short === LINT_META ? LINT_META : `eslint-plugin-${short}`);
}

/** Route of a rule page, relative to the site base, with a trailing slash. */
export function ruleRoute(short: string, rule: string): string {
  return `rules/${short}/${rule}/`;
}

/** Absolute public URL of a rule page. */
export function ruleUrl(short: string, rule: string): string {
  return `${SITE_ORIGIN}${SITE_BASE}/${ruleRoute(short, rule)}`;
}

/**
 * Where to read a package's exports from. `dist` is what ships, so the site
 * and its link check read it. `src` cannot go stale, so the parity guard reads
 * it: a rule added to source and not yet built must still fail the guard.
 */
export type InventorySource = 'src' | 'dist';

async function importEntry(
  dir: string,
  entry: string,
  from: InventorySource,
): Promise<Record<string, unknown>> {
  const path = join(dir, from, from === 'src' ? `${entry}.ts` : `${entry}.js`);
  if (!existsSync(path)) {
    throw new Error(
      from === 'dist'
        ? `${path} is missing. Build the packages first (\`bun run build\` at the repo root).`
        : `${path} is missing.`,
    );
  }
  return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
}

/**
 * Whether a rule needs type information. No rule declares this in its `meta`,
 * so it is read from the rule's own source and the modules it imports
 * relatively: `getParserServices(context)` throws without a program (required);
 * reading `parserServices` directly uses types only when present (optional).
 */
function detectTypeInfo(dir: string, rule: string): TypeInfo {
  const file = join(dir, 'src', 'rules', `${rule}.ts`);
  if (!existsSync(file)) throw new Error(`No source file for rule ${rule} at ${file}`);
  const sources = [readFileSync(file, 'utf8')];
  for (const m of sources[0]!.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
    const base = resolve(dirname(file), m[1]!);
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      if (existsSync(candidate)) sources.push(readFileSync(candidate, 'utf8'));
    }
  }
  const text = sources.join('\n');
  if (/getParserServices\(\s*context\s*\)/.test(text)) return 'required';
  if (/\bparserServices\b/.test(text)) return 'optional';
  return 'none';
}

/** ESLint's `DeprecatedInfo` (ESLint 9.21+ and 10), as far as the docs read it. */
export interface DeprecatedInfoLike {
  message?: string;
  url?: string;
  deprecatedSince?: string;
  availableUntil?: string | null;
  replacedBy?: readonly { plugin?: { name?: string; url?: string }; rule?: { name?: string; url?: string } }[];
}

export interface RuleModuleLike {
  meta?: {
    docs?: { description?: string; url?: string; requiresOptions?: boolean };
    fixable?: string;
    hasSuggestions?: boolean;
    // ESLint 9.21+ takes an object here; the boolean form is the older one.
    deprecated?: boolean | DeprecatedInfoLike;
    // The older list of replacement ids, still the only one ESLint 9.0 to 9.20 reports.
    replacedBy?: readonly string[];
    schema?: unknown;
  };
}

/** A rule takes options unless its schema is missing or an empty array. */
function takesOptions(rule: RuleModuleLike): boolean {
  const schema = rule.meta?.schema;
  if (schema === undefined || schema === false) return false;
  return !Array.isArray(schema) || schema.length > 0;
}

/**
 * Qualify a replacement rule name. A bare name is a rule in the same plugin,
 * which is what ESLint means when `plugin` is omitted; `@noctcore/eslint-plugin-<x>`
 * or `noctcore-<x>` as the plugin name means `noctcore-<x>/<name>`.
 */
function qualify(name: string, namespace: string, plugin?: string): string {
  if (name.includes('/')) return name;
  if (!plugin) return `${namespace}/${name}`;
  const short = /^(?:@noctcore\/eslint-plugin-|noctcore-)(.+)$/.exec(plugin)?.[1];
  return short ? `noctcore-${short}/${name}` : `${plugin}/${name}`;
}

export interface Deprecation {
  readonly deprecated: boolean;
  readonly replacedBy: readonly string[];
  readonly deprecatedSince: string | null;
  readonly deprecationMessage: string | null;
}

/**
 * A rule's deprecation, read from either shape ESLint accepts: the object
 * `meta.deprecated` (`DeprecatedInfo`) and the older `meta.deprecated: true`
 * plus `meta.replacedBy: string[]`. Replacement ids come back fully qualified.
 */
export function deprecationOf(rule: RuleModuleLike, namespace: string): Deprecation {
  const deprecated = rule.meta?.deprecated;
  const info = typeof deprecated === 'object' ? deprecated : null;
  const fromObject = (info?.replacedBy ?? []).flatMap((entry) =>
    entry.rule?.name ? [qualify(entry.rule.name, namespace, entry.plugin?.name)] : [],
  );
  const fromList = (rule.meta?.replacedBy ?? []).map((name) => qualify(name, namespace));
  return {
    deprecated: Boolean(deprecated),
    replacedBy: [...new Set([...fromObject, ...fromList])],
    deprecatedSince: info?.deprecatedSince ?? null,
    deprecationMessage: info?.message?.trim() || null,
  };
}

interface MetaRuleLike {
  id: string;
  description: string;
  category: string;
  ciCritical: boolean;
}

function readPackageJson(dir: string): { name: string; version: string; description: string } {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

async function loadPlugin(short: string, from: InventorySource): Promise<PackageEntry> {
  const dir = packageDirOf(short);
  const pkg = readPackageJson(dir);
  const mod = await importEntry(dir, 'index', from);
  const plugin = mod.default as {
    rules: Record<string, RuleModuleLike>;
    configs: { recommended?: { rules?: Record<string, unknown> } };
  };
  const namespace = `noctcore-${short}`;
  const preset = plugin.configs.recommended?.rules ?? {};
  const rules = Object.entries(plugin.rules).map(([name, rule]): RuleEntry => {
    const id = `${namespace}/${name}`;
    const severity = preset[id];
    return {
      name,
      id,
      description: rule.meta?.docs?.description ?? '',
      recommended: severity === undefined ? null : String(Array.isArray(severity) ? severity[0] : severity),
      fixable: Boolean(rule.meta?.fixable),
      hasSuggestions: Boolean(rule.meta?.hasSuggestions),
      typeInfo: detectTypeInfo(dir, name),
      requiresOptions: rule.meta?.docs?.requiresOptions === true,
      hasOptions: takesOptions(rule),
      ...deprecationOf(rule, namespace),
      docsUrl: rule.meta?.docs?.url ?? null,
    };
  });
  return {
    short,
    npmName: pkg.name,
    kind: 'eslint-plugin',
    namespace,
    version: pkg.version,
    description: pkg.description,
    dir,
    rules: rules.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function metaRuleEntry(rule: MetaRuleLike, factory: string, entry: string): RuleEntry {
  return {
    name: rule.id,
    id: rule.id,
    description: rule.description,
    recommended: null,
    fixable: false,
    hasSuggestions: false,
    typeInfo: 'none',
    requiresOptions: false,
    hasOptions: true,
    deprecated: false,
    replacedBy: [],
    deprecatedSince: null,
    deprecationMessage: null,
    docsUrl: null,
    category: rule.category,
    ciCritical: rule.ciCritical,
    factory,
    entry,
  };
}

async function loadLintMeta(from: InventorySource): Promise<PackageEntry> {
  const dir = packageDirOf(LINT_META);
  const pkg = readPackageJson(dir);
  const rules: RuleEntry[] = [];
  const main = await importEntry(dir, 'index', from);
  const factories = main.RULE_FACTORIES as Record<string, () => MetaRuleLike>;
  for (const factory of Object.values(factories)) {
    const rule = factory();
    rules.push(metaRuleEntry(rule, factory.name, pkg.name));
  }
  // The sub-entry factories are not in RULE_FACTORIES; every exported
  // `create*Rule` on those entry points is a rule.
  for (const sub of LINT_META_SUBPATHS) {
    const mod = await importEntry(dir, sub, from);
    for (const [exportName, value] of Object.entries(mod)) {
      if (!/^create\w+Rule$/.test(exportName) || typeof value !== 'function') continue;
      const rule = (value as () => MetaRuleLike)();
      rules.push(metaRuleEntry(rule, exportName, `${pkg.name}/${sub}`));
    }
  }
  return {
    short: LINT_META,
    npmName: pkg.name,
    kind: 'lint-meta',
    namespace: null,
    version: pkg.version,
    description: pkg.description,
    dir,
    rules: rules.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Every package with rules, plugins first in display order, then lint-meta. */
export async function loadInventory(from: InventorySource = 'dist'): Promise<PackageEntry[]> {
  const plugins = await Promise.all(PLUGIN_SHORT_NAMES.map((short) => loadPlugin(short, from)));
  return [...plugins, await loadLintMeta(from)];
}

export interface DocEntry {
  readonly short: string;
  readonly rule: string;
  readonly path: string;
}

/** Every `packages/*\/docs/rules/*.md`, whatever package it sits in. */
export function listRuleDocs(): DocEntry[] {
  const docs: DocEntry[] = [];
  for (const pkgDir of readdirSync(PACKAGES_DIR).sort()) {
    const rulesDir = join(PACKAGES_DIR, pkgDir, 'docs', 'rules');
    if (!existsSync(rulesDir)) continue;
    const short = pkgDir.startsWith('eslint-plugin-') ? pkgDir.slice('eslint-plugin-'.length) : pkgDir;
    for (const file of readdirSync(rulesDir).sort()) {
      if (!file.endsWith('.md')) continue;
      docs.push({ short, rule: file.slice(0, -3), path: join(rulesDir, file) });
    }
  }
  return docs;
}
