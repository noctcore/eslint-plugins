import { ruleTester } from '@noctcore/eslint-test-utils';

import { noDeepPackageImportsRule } from '../../src/rules/no-deep-package-imports';

// The rule has no default scope, so every case passes `scopes` explicitly.
const SCOPED = [{ scopes: ['@acme'] }] as const;

ruleTester.run('no-deep-package-imports', noDeepPackageImportsRule, {
  valid: [
    // Barrel import — the only sanctioned form.
    { code: `import { TaskSchema } from '@acme/contracts';`, options: SCOPED },
    // Non-configured-scope deep imports are not this rule's concern.
    { code: `import { z } from 'zod/lib';`, options: SCOPED },
    // A different scope than the configured one is ignored.
    { code: `import { thing } from '@other/pkg/internal/thing';`, options: SCOPED },
    // Re-export from the barrel.
    { code: `export { Foo } from '@acme/shared';`, options: SCOPED },
    // Trailing slash is not a deep entry (no subpath after the barrel).
    { code: `import x from '@acme/contracts/';`, options: SCOPED },
    // With NO scopes configured the rule is inert — nothing fires.
    { code: `import { thing } from '@acme/contracts/internal/thing';`, options: [{ scopes: [] }] },
    // An allowed-subpath escape hatch permits an otherwise-deep entry.
    {
      code: `import pkg from '@acme/contracts/package.json';`,
      options: [{ scopes: ['@acme'], allowedSubpaths: ['package.json'] }],
    },
  ],
  invalid: [
    // Deep subpath into a package's internals.
    {
      code: `import { thing } from '@acme/contracts/internal/thing';`,
      options: SCOPED,
      errors: [{ messageId: 'deepImport' }],
    },
    // Deep export-from.
    {
      code: `export { thing } from '@acme/engine/src/sdk-adapter';`,
      options: SCOPED,
      errors: [{ messageId: 'deepImport' }],
    },
    // Deep dynamic import.
    {
      code: `const m = await import('@acme/storage/dist/session-store');`,
      options: SCOPED,
      errors: [{ messageId: 'deepImport' }],
    },
    // Multiple configured scopes: a deep import into the SECOND scope reds.
    {
      code: `import { thing } from '@beta/contracts/internal/thing';`,
      options: [{ scopes: ['@acme', '@beta'] }],
      errors: [{ messageId: 'deepImport' }],
    },
    // A subpath not in `allowedSubpaths` still reds even when the hatch is set.
    {
      code: `import x from '@acme/contracts/internal/thing';`,
      options: [{ scopes: ['@acme'], allowedSubpaths: ['package.json'] }],
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});
