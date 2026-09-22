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
