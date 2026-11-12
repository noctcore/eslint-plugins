/**
 * Starlight route middleware: the per-page data the rail cannot give.
 *
 * - Rule pages are not in the rail, so Starlight derives no previous and next
 *   for them. They get the neighbouring rules in catalog order, and the rail
 *   marks their package as the current page.
 * - Package pages and the overview drop the "on this page" column, so the
 *   rules board and the overview use the full width.
 */
import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data';

import { href, packageForRoute, ruleForRoute, ruleNeighbours, type CatalogPackage, type CatalogRule } from './catalog';

type SidebarEntry = StarlightRouteData['sidebar'][number];
type SidebarLink = Extract<SidebarEntry, { type: 'link' }>;

function pagerLink(from: CatalogPackage, to: { pkg: CatalogPackage; rule: CatalogRule } | null): SidebarLink | undefined {
  if (!to) return undefined;
  return {
    type: 'link',
    label: to.pkg.short === from.short ? to.rule.name : `${to.pkg.short}/${to.rule.name}`,
    href: href(to.rule.route),
    isCurrent: false,
    badge: undefined,
    attrs: {},
  };
}

function markCurrent(entries: SidebarEntry[], target: string): void {
  for (const entry of entries) {
    if (entry.type === 'link') {
      if (entry.href === target) entry.isCurrent = true;
    } else {
      markCurrent(entry.entries, target);
    }
  }
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const hit = ruleForRoute(route.id);
  if (hit) {
    const { prev, next } = ruleNeighbours(route.id);
    route.pagination = { prev: pagerLink(hit.pkg, prev), next: pagerLink(hit.pkg, next) };
    markCurrent(route.sidebar, href(`packages/${hit.pkg.short}/`));
    return;
  }
  if (packageForRoute(route.id) || route.id === '' || route.id === 'index') route.toc = undefined;
});
