/**
 * The single inventory of every rule and every rule doc in this repo.
 *
 * Rules are read from what each package actually EXPORTS, not from a directory
 * listing: the exported surface is what a consumer gets,
 * and 4 of the lint-meta rules live outside `src/rules/` behind their own entry
 * points (`/i18n`, `/prisma`, `/resolved-config`). A listing of
 * `packages/*\/src/rules/*.ts` finds 93 and is blind to those 4.
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
] as const;

export const LINT_META = 'lint-meta-rules';

/** lint-meta-rules entry points other than the main catalog. */
const LINT_META_SUBPATHS = ['i18n', 'prisma', 'resolved-config'] as const;

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

interface RuleModuleLike {
  meta?: {
    docs?: { description?: string; url?: string };
    fixable?: string;
    hasSuggestions?: boolean;
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
