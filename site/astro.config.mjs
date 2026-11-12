import { readdirSync } from 'node:fs';

import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

import { STACK_GROUPS, STARTER } from './src/lib/stacks.ts';

const PACKAGES_DIR = new URL('../packages/', import.meta.url);

/** How many rule docs a package ships: the rail's count, read from the source of truth. */
function ruleCount(short) {
  const dir = short === 'lint-meta-rules' ? short : `eslint-plugin-${short}`;
  return readdirSync(new URL(`${dir}/docs/rules/`, PACKAGES_DIR)).filter((file) => file.endsWith('.md')).length;
}

const TOTAL_RULES = readdirSync(PACKAGES_DIR)
  .filter((dir) => dir.startsWith('eslint-plugin-') || dir === 'lint-meta-rules')
  .reduce((sum, dir) => sum + ruleCount(dir.replace(/^eslint-plugin-/, '')), 0);

/** A package in the rail: its short name and its rule count. */
function packageLink(short) {
  return { label: short, link: `/packages/${short}/`, badge: String(ruleCount(short)) };
}

// Project Pages for github.com/noctcore/eslint-plugins serve from
// https://noctcore.github.io/eslint-plugins/. A wrong `base` still builds green
// and 404s every asset, which is why scripts/check-build.ts reads the emitted
// HTML rather than trusting the exit code.
//
// No markdown processor is configured: this site runs no remark plugins. The
// rule pages are shaped by scripts/sync.ts before Astro sees them, so Astro 7's
// default pipeline is enough. Code block behaviour lives in ec.config.mjs.
export default defineConfig({
  site: 'https://noctcore.github.io',
  base: '/eslint-plugins',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'noctcore ESLint plugins',
      description:
        'Focused ESLint plugins for architecture and correctness conventions generic linters cannot see: cross-file boundaries, IO contracts, and code that compiles but bites in production.',
      favicon: '/favicon.svg',
      // The inspection-sheet theme in its load order: tokens (and the
      // self-hosted fonts), element and Starlight chrome, the site's own
      // pieces, then the responsive rules.
      customCss: [
        './src/styles/tokens.css',
        './src/styles/base.css',
        './src/styles/components.css',
        './src/styles/layout.css',
      ],
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        PageTitle: './src/components/PageTitle.astro',
        Footer: './src/components/Footer.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        Pagination: './src/components/Pagination.astro',
        Sidebar: './src/components/Sidebar.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
        Search: './src/components/Search.astro',
      },
      // The Search override is a palette over the catalog; Pagefind's index
      // would be built and shipped for nothing.
      pagefind: false,
      // src/pages/404.astro is the not-found page; Starlight's injected one
      // would claim the same route.
      disable404Route: true,
      // Not under src/pages or src/middleware, where Starlight refuses it.
      routeMiddleware: './src/lib/route-data.ts',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/noctcore/eslint-plugins' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/org/noctcore' },
      ],
      // Rule pages carry their own editUrl (the source doc under packages/);
      // this base covers the hand-written pages under site/.
      editLink: { baseUrl: 'https://github.com/noctcore/eslint-plugins/edit/main/site/' },
      // The rail follows the overview: the guide, the starter set, one group
      // per stack (src/lib/stacks.ts), then the repo checks. Rule pages are
      // reached from their package; src/lib/route-data.ts gives them previous
      // and next links in catalog order.
      sidebar: [
        {
          label: 'Guide',
          items: [
            { label: 'Overview', link: '/' },
            { label: 'Getting started', link: '/getting-started/' },
            { label: 'Adopting in an existing codebase', link: '/adopting/' },
            { label: 'Rules that read other files', link: '/filesystem-rules/' },
            { label: 'All rules', link: '/rules/', badge: String(TOTAL_RULES) },
          ],
        },
        { label: 'Start here', items: STARTER.map(({ short }) => packageLink(short)) },
        ...STACK_GROUPS.map((group) => ({ label: group.label, items: group.packages.map(({ short }) => packageLink(short)) })),
        { label: 'Repo checks', items: [packageLink('lint-meta-rules')] },
      ],
    }),
  ],
  vite: {
    // Starlight renders some Markdown at prerender time through Satteri, whose
    // native binding is an optional dependency of the `satteri` package. Bun's
    // isolated linker keeps that binding next to `satteri` only, so bundling
    // `satteri` into dist/.prerender breaks the lookup. Leave it external in
    // Astro 7's prerender environment, which is separate from `ssr`.
    environments: { prerender: { resolve: { external: ['satteri'] } } },
  },
});
