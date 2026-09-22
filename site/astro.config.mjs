import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
      logo: { src: './src/assets/mark.svg', alt: '' },
      customCss: ['./src/styles/theme.css'],
      components: {
        Head: './src/components/Head.astro',
        Footer: './src/components/Footer.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/noctcore/eslint-plugins' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/org/noctcore' },
      ],
      // Rule pages carry their own editUrl (the source doc under packages/);
      // this base covers the hand-written pages under site/.
      editLink: { baseUrl: 'https://github.com/noctcore/eslint-plugins/edit/main/site/' },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Getting started', link: '/getting-started/' },
            { label: 'Adopting in an existing codebase', link: '/adopting/' },
          ],
        },
        { label: 'Packages', items: [{ autogenerate: { directory: 'packages' } }] },
        {
          label: 'Rules',
          items: [
            { label: 'All rules', link: '/rules/' },
            ...[
              ['react', 'React'],
              ['architecture', 'Architecture'],
              ['monorepo', 'Monorepo'],
              ['contracts', 'Contracts'],
              ['code-quality', 'Code quality'],
              ['async-safety', 'Async safety'],
              ['observability', 'Observability'],
              ['security', 'Security'],
              ['prisma', 'Prisma'],
              ['lint-meta-rules', 'lint-meta rules'],
            ].map(([directory, label]) => ({
              label,
              collapsed: true,
              items: [{ autogenerate: { directory: `rules/${directory}` } }],
            })),
          ],
        },
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
