import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRestrictedImportsLayeredRule } from '../../src/rules/no-restricted-imports-layered';

// The nightcore shape: two SDKs banned from every surface, each confined to its
// own provider folder inside the engine. Declared once, merged per file.
const SDK_OPTIONS = [
  {
    bans: {
      claudeSdk: [
        {
          modules: ['@anthropic-ai/claude-agent-sdk'],
          message: 'The Claude SDK is confined to packages/engine/src/providers/claude/**.',
        },
      ],
      codexSdk: [
        {
          modules: ['@openai/codex-sdk'],
          message: 'The Codex SDK is confined to packages/engine/src/providers/codex/**.',
        },
      ],
      engine: [{ modules: ['@nightcore/engine'], message: 'Capability packages must not import the engine.' }],
    },
    layers: [
      { files: ['apps/**'], bans: ['claudeSdk', 'codexSdk'] },
      {
        files: ['packages/engine/src/**'],
        ignores: ['packages/engine/src/providers/claude/**', '**/*.test.ts'],
        bans: ['claudeSdk'],
      },
      {
        files: ['packages/engine/src/**'],
        ignores: ['packages/engine/src/providers/codex/**', '**/*.test.ts'],
        bans: ['codexSdk'],
      },
      { files: ['packages/skills/**'], bans: ['engine', 'claudeSdk'] },
    ],
  },
] as const;

// The Settly shape: the web app's layers, with the server alias type-only and
// the dynamic form covered without a second `no-restricted-syntax` copy.
const WEB_OPTIONS = [
  {
    bans: {
      apiTypeOnly: [{ modules: ['@api/*'], allowTypeImports: true, message: 'Use `import type` from "@api".' }],
      noFeatures: [{ modules: ['@/features', '**/features'], message: 'Move the shared piece down a layer.' }],
      noRoutes: [{ modules: ['@/routes', '**/routes', '**/routeTree.gen'] }],
    },
    layers: [
      { files: ['src/**'], ignores: ['**/*.test.*', '**/*.stories.*'], bans: ['apiTypeOnly'] },
      { files: ['src/{lib,stores,hooks}/**'], ignores: ['**/*.test.*'], bans: ['noFeatures', 'noRoutes'] },
      { files: ['src/features/**'], ignores: ['**/*.test.*'], bans: ['noRoutes'] },
    ],
  },
] as const;

const SURFACE = 'apps/web/src/board/useRun.ts';
const ENGINE_CORE = 'packages/engine/src/session/run.ts';
const CLAUDE_PROVIDER = 'packages/engine/src/providers/claude/query.ts';
const SKILL = 'packages/skills/src/review.ts';

ruleTester.run('no-restricted-imports-layered', noRestrictedImportsLayeredRule, {
  valid: [
    // Inside its own provider folder an SDK is allowed, and tests are ignored.
    { code: `import { query } from '@anthropic-ai/claude-agent-sdk';`, filename: CLAUDE_PROVIDER, options: SDK_OPTIONS },
    { code: `import { query } from '@anthropic-ai/claude-agent-sdk';`, filename: 'packages/engine/src/session/run.test.ts', options: SDK_OPTIONS },
    // A file no layer matches is unrestricted.
    { code: `import { query } from '@anthropic-ai/claude-agent-sdk';`, filename: 'tools/probe.ts', options: SDK_OPTIONS },
    // A module whose name only starts with the banned one is a different module.
    { code: `import x from '@anthropic-ai/claude-agent-sdk-mock';`, filename: SURFACE, options: SDK_OPTIONS },
    // The surface talks to the engine, which is not banned there.
    { code: `import { runTask } from '@nightcore/engine';`, filename: SURFACE, options: SDK_OPTIONS },
    // Type-only imports of the server alias are allowed, in every spelling.
    { code: `import type { AppRouter } from '@api/trpc';`, filename: 'src/lib/trpc.ts', options: WEB_OPTIONS },
    { code: `import { type AppRouter } from '@api/trpc';`, filename: 'src/lib/trpc.ts', options: WEB_OPTIONS },
    { code: `export type { AppRouter } from '@api/trpc';`, filename: 'src/lib/trpc.ts', options: WEB_OPTIONS },
    // A feature may import lib; a route may import a feature.
    { code: `import { formatDate } from '@/lib/dates';`, filename: 'src/features/billing/Invoice.tsx', options: WEB_OPTIONS },
    { code: `import { InvoiceList } from '@/features/billing';`, filename: 'src/routes/invoices.tsx', options: WEB_OPTIONS },
    // A computed dynamic import cannot be resolved and is left alone.
    { code: `const page = await import(\`@/features/\${name}\`);`, filename: 'src/lib/load.ts', options: WEB_OPTIONS },
    // A name ban leaves the other names, and dynamic imports, alone.
    {
      code: `import { useQuery } from '@tanstack/react-query';\nconst q = await import('@tanstack/react-query');`,
      filename: 'src/lib/query.ts',
      options: [
        {
          bans: { legacy: [{ modules: ['@tanstack/react-query'], importNames: ['useQueries'] }] },
          layers: [{ files: ['src/**'], bans: ['legacy'] }],
        },
      ],
    },
    // No options: nothing to check.
    { code: `import { query } from '@anthropic-ai/claude-agent-sdk';`, filename: SURFACE },
  ],
  invalid: [
    // The SDK ban reaches every surface, subpaths included.
    {
      code: `import { query } from '@anthropic-ai/claude-agent-sdk';\nimport type { Options } from '@anthropic-ai/claude-agent-sdk/types';`,
      filename: SURFACE,
      options: SDK_OPTIONS,
      errors: [
        {
          messageId: 'banned',
          data: {
            source: '@anthropic-ai/claude-agent-sdk',
            set: 'claudeSdk',
            message: ' The Claude SDK is confined to packages/engine/src/providers/claude/**.',
          },
          line: 1,
          column: 23,
        },
        { messageId: 'banned', data: { source: '@anthropic-ai/claude-agent-sdk/types', set: 'claudeSdk', message: ' The Claude SDK is confined to packages/engine/src/providers/claude/**.' }, line: 2 },
      ],
    },
    // Two layers match the engine core, and both bans apply: merged, not overridden.
    {
      code: `import { query } from '@anthropic-ai/claude-agent-sdk';\nimport { Codex } from '@openai/codex-sdk';`,
      filename: ENGINE_CORE,
      options: SDK_OPTIONS,
      errors: [
        { messageId: 'banned', data: { source: '@anthropic-ai/claude-agent-sdk', set: 'claudeSdk', message: ' The Claude SDK is confined to packages/engine/src/providers/claude/**.' } },
        { messageId: 'banned', data: { source: '@openai/codex-sdk', set: 'codexSdk', message: ' The Codex SDK is confined to packages/engine/src/providers/codex/**.' } },
      ],
    },
    // The claude provider may use its SDK but not the other one.
    {
      code: `import { Codex } from '@openai/codex-sdk';`,
      filename: CLAUDE_PROVIDER,
      options: SDK_OPTIONS,
      errors: [{ messageId: 'banned', data: { source: '@openai/codex-sdk', set: 'codexSdk', message: ' The Codex SDK is confined to packages/engine/src/providers/codex/**.' } }],
    },
    // Re-exports and dynamic imports are imports too.
    {
      code: [
        `export { runTask } from '@nightcore/engine';`,
        `export * from '@nightcore/engine/events';`,
        `const engine = await import('@nightcore/engine');`,
        `const sdk = await import(\`@anthropic-ai/claude-agent-sdk\`);`,
      ].join('\n'),
      filename: SKILL,
      options: SDK_OPTIONS,
      errors: [
        { messageId: 'banned', line: 1 },
        { messageId: 'banned', line: 2 },
        { messageId: 'banned', line: 3, column: 29 },
        { messageId: 'banned', data: { source: '@anthropic-ai/claude-agent-sdk', set: 'claudeSdk', message: ' The Claude SDK is confined to packages/engine/src/providers/claude/**.' }, line: 4 },
      ],
    },
    // Settly: lib may not reach up into a feature or a route, in alias, relative or dynamic form.
    {
      code: [
        `import { InvoiceList } from '@/features/billing';`,
        `import { useInvoice } from '../features/billing/hooks';`,
        `import { routeTree } from '@/routeTree.gen';`,
        `const screen = await import('../../routes/invoices');`,
      ].join('\n'),
      filename: 'src/lib/prefetch.ts',
      options: WEB_OPTIONS,
      errors: [
        { messageId: 'banned', data: { source: '@/features/billing', set: 'noFeatures', message: ' Move the shared piece down a layer.' } },
        { messageId: 'banned', data: { source: '../features/billing/hooks', set: 'noFeatures', message: ' Move the shared piece down a layer.' } },
        { messageId: 'banned', data: { source: '@/routeTree.gen', set: 'noRoutes', message: '' } },
        { messageId: 'banned', data: { source: '../../routes/invoices', set: 'noRoutes', message: '' } },
      ],
    },
    // The server alias: a value import, a mixed import and a side-effect import.
    {
      code: [
        `import { appRouter } from '@api/trpc';`,
        `import { type AppRouter, createCaller } from '@api/trpc';`,
        `import '@api/polyfills';`,
      ].join('\n'),
      filename: 'src/features/billing/client.ts',
      options: WEB_OPTIONS,
      errors: [
        { messageId: 'banned', line: 1 },
        { messageId: 'banned', line: 2 },
        { messageId: 'banned', line: 3 },
      ],
    },
    // A name ban reports each banned name, including a namespace import.
    {
      code: `import { useQueries, useQuery } from '@tanstack/react-query';\nimport * as rq from '@tanstack/react-query';`,
      filename: 'src/lib/query.ts',
      options: [
        {
          bans: { legacy: [{ modules: ['@tanstack/react-query'], importNames: ['useQueries'], message: 'Use `useSuspenseQueries`.' }] },
          layers: [{ files: ['src/**'], bans: ['legacy'] }],
        },
      ],
      errors: [
        { messageId: 'bannedName', data: { name: 'useQueries', source: '@tanstack/react-query', set: 'legacy', message: ' Use `useSuspenseQueries`.' }, line: 1, column: 10 },
        { messageId: 'bannedName', data: { name: '*', source: '@tanstack/react-query', set: 'legacy', message: ' Use `useSuspenseQueries`.' }, line: 2 },
      ],
    },
    // A layer glob anchored with `**/` matches the absolute path too.
    {
      code: `import { query } from '@anthropic-ai/claude-agent-sdk';`,
      filename: 'apps/desktop/src/main.ts',
      options: [
        {
          bans: { sdk: [{ modules: ['@anthropic-ai/claude-agent-sdk'] }] },
          layers: [{ files: ['**/apps/desktop/**'], bans: ['sdk'] }],
        },
      ],
      errors: [{ messageId: 'banned', data: { source: '@anthropic-ai/claude-agent-sdk', set: 'sdk', message: '' } }],
    },
  ],
});
