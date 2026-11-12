/**
 * How the plugins group on the overview, the index rail and the Getting
 * started table: the starter set, then one group per stack. The one place the
 * "when to add it" copy lives; the descriptions, counts and versions next to
 * it all come from the generated catalog. Pure, so astro.config.mjs and the
 * site tests can import it without a sync having run.
 */

export interface StarterPackage {
  readonly short: string;
  /** A rule that shows what the package catches, linked from its overview card. */
  readonly sample: string;
}

export interface StackPackage {
  readonly short: string;
  /** When to add it, in Markdown (code spans allowed). */
  readonly when: string;
}

export interface StackGroup {
  readonly label: string;
  readonly packages: readonly StackPackage[];
}

/** The three plugins that fit almost any TypeScript codebase. */
export const STARTER: readonly StarterPackage[] = [
  { short: 'code-quality', sample: 'no-vacuous-expect' },
  { short: 'async-safety', sample: 'require-fetch-timeout' },
  { short: 'contracts', sample: 'fetch-must-check-ok' },
];

export const STARTER_WHEN = 'Always: the starter set';

export const STACK_GROUPS: readonly StackGroup[] = [
  {
    label: 'Server and data',
    packages: [
      { short: 'security', when: 'You run server code (shell, HTTP, redirects, HTML rendering)' },
      { short: 'observability', when: 'You log through a structured logger' },
      { short: 'prisma', when: 'You use Prisma (several rules need your tenant models)' },
      { short: 'nestjs', when: 'You run BullMQ queues or `@nestjs/schedule` cron jobs' },
      { short: 'llm', when: 'You call an LLM SDK' },
      {
        short: 'dates',
        when: 'You store calendar days (due dates, leave days) as `Date`s and have a calendar module',
      },
    ],
  },
  {
    label: 'Frontend and apps',
    packages: [
      { short: 'react', when: 'You write React components' },
      { short: 'rsc', when: 'You use the Next.js App Router / React Server Components' },
      { short: 'query', when: 'You use TanStack Query, with or without tRPC' },
      { short: 'electron', when: 'You ship an Electron app' },
    ],
  },
  {
    label: 'Shape of the repo',
    packages: [
      { short: 'architecture', when: 'You want folder and package boundaries enforced' },
      { short: 'monorepo', when: 'You want workspace package boundaries enforced (it needs your scope)' },
    ],
  },
];

/** The rule the overview's hero diagnostic shows, read from its doc's first Incorrect example. */
export const HERO = {
  short: 'contracts',
  rule: 'fetch-must-check-ok',
  highlight: 'res.json()',
  file: 'src/api/users.ts',
} as const;

/**
 * Every plugin sits in exactly one place: the starter set or one stack group.
 * A new plugin fails the build here until someone places it.
 */
export function checkStacks(pluginShorts: readonly string[]): void {
  const placed = [...STARTER.map((p) => p.short), ...STACK_GROUPS.flatMap((g) => g.packages.map((p) => p.short))];
  const known = new Set(pluginShorts);
  const problems: string[] = [];
  for (const short of new Set(placed)) {
    const count = placed.filter((p) => p === short).length;
    if (count > 1) problems.push(`${short} is placed ${count} times`);
    if (!known.has(short)) problems.push(`${short} is placed but is not a plugin`);
  }
  for (const short of pluginShorts) {
    if (!placed.includes(short)) problems.push(`${short} is in no stack group`);
  }
  if (problems.length > 0) throw new Error(`site/src/lib/stacks.ts is out of date: ${problems.join('; ')}`);
}
