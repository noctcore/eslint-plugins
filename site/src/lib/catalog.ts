/**
 * Typed access to src/generated/catalog.json, which scripts/sync.ts writes from
 * each package's exported rules and their `meta`. Components read rule facts
 * from here and nowhere else, so no table on the site is typed by hand.
 */
import catalog from '../generated/catalog.json';

export type Catalog = typeof catalog;
export type CatalogPackage = Catalog[number];
export type CatalogRule = CatalogPackage['rules'][number];

export const packages: readonly CatalogPackage[] = catalog;

export function getPackage(short: string): CatalogPackage {
  const pkg = packages.find((p) => p.short === short);
  if (!pkg) throw new Error(`No package "${short}" in the generated catalog. Run \`bun run sync\`.`);
  return pkg;
}

/** Prefix a site-relative route (`rules/react/x/`) with the deploy base. */
export function href(route: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return `${base}${route.replace(/^\//, '')}`;
}

/** `code-quality` -> `codeQuality`, the import name the snippets use. */
export function importName(short: string): string {
  return short.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function enabledInPreset(pkg: CatalogPackage): number {
  return pkg.rules.filter((rule) => rule.recommended === 'error').length;
}

/** `1 rule`, `2 rules`: a count with its noun, singular when the count is one. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Rule descriptions use Markdown code spans. Split on the backtick: odd
 * segments are code. Shared by every table that renders a description.
 */
export function codeSpans(text: string): { part: string; code: boolean }[] {
  return text.split('`').map((part, i) => ({ part, code: i % 2 === 1 }));
}

export function presetLabel(severity: string | null): 'error' | 'off' | 'not listed' {
  return severity === 'error' ? 'error' : severity === 'off' ? 'off' : 'not listed';
}

/**
 * The rules that replace a deprecated one, each with its route when it is in
 * the catalog. The catalog is JSON, so with no deprecated rule `replacedBy`
 * infers as `never[]`; the cast is the real shape.
 */
export function replacementsOf(rule: CatalogRule): { id: string; route: string | null }[] {
  const routes = new Map<string, string>();
  for (const pkg of packages) for (const candidate of pkg.rules) routes.set(candidate.id, candidate.route);
  return (rule.replacedBy as readonly string[]).map((id) => ({ id, route: routes.get(id) ?? null }));
}
