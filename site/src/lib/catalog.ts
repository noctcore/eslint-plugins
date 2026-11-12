/**
 * Typed access to src/generated/catalog.json, which scripts/sync.ts writes from
 * each package's exported rules and their `meta`. Components read rule facts
 * from here and nowhere else, so no table on the site is typed by hand.
 */
import catalog from '../generated/catalog.json';

export { codeSpans, importName, plural, presetLabel } from './format';

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

export function enabledInPreset(pkg: CatalogPackage): number {
  return pkg.rules.filter((rule) => rule.recommended === 'error').length;
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
