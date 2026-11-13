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

/** The rule a Starlight route id (`rules/contracts/fetch-must-check-ok`) renders, or null. */
export function ruleForRoute(routeId: string): { pkg: CatalogPackage; rule: CatalogRule } | null {
  const route = `${routeId.replace(/\/$/, '')}/`;
  for (const pkg of packages) {
    const rule = pkg.rules.find((candidate) => candidate.route === route);
    if (rule) return { pkg, rule };
  }
  return null;
}

/** The package a Starlight route id (`packages/contracts`) renders, or null. */
export function packageForRoute(routeId: string): CatalogPackage | null {
  const match = /^packages\/([^/]+)\/?$/.exec(routeId);
  return match ? (packages.find((pkg) => pkg.short === match[1]) ?? null) : null;
}

/**
 * The rules before and after one, in catalog order: packages in display
 * order, rules by name, across package boundaries (llm and rsc have one rule
 * each, so a pager kept inside a package would give them no link at all).
 */
export function ruleNeighbours(routeId: string): {
  prev: { pkg: CatalogPackage; rule: CatalogRule } | null;
  next: { pkg: CatalogPackage; rule: CatalogRule } | null;
} {
  const order = packages.flatMap((pkg) => pkg.rules.map((rule) => ({ pkg, rule })));
  const route = `${routeId.replace(/\/$/, '')}/`;
  const i = order.findIndex(({ rule }) => rule.route === route);
  if (i === -1) return { prev: null, next: null };
  return { prev: order[i - 1] ?? null, next: order[i + 1] ?? null };
}
