import { ruleTester } from '@noctcore/eslint-test-utils';

import { noUnexportedSubpathImportRule } from '../../src/rules/no-unexported-subpath-import';

// Every case imports from a file inside the fixture workspace so the rule can
// walk up to tests/fixtures/ws and read the target package's `exports` on disk.
const FILENAME = 'tests/fixtures/ws/packages/app/src/consumer.ts';
const ACME = [{ scopes: ['@acme'] }] as const;

ruleTester.run('no-unexported-subpath-import', noUnexportedSubpathImportRule, {
  valid: [
    // The barrel is not a subpath — never checked.
    { code: `import x from '@acme/contracts';`, filename: FILENAME, options: ACME },
    // An exactly-listed subpath.
    { code: `import x from '@acme/contracts/schemas';`, filename: FILENAME, options: ACME },
    // A subpath matched by a `./features/*` wildcard.
    { code: `import x from '@acme/contracts/features/auth';`, filename: FILENAME, options: ACME },
    // A package with no `exports` map does not restrict subpaths.
    { code: `import x from '@acme/legacy/dist/anything';`, filename: FILENAME, options: ACME },
    // Target package not found in the workspace — the rule stays silent.
    { code: `import x from '@acme/ghost/internal';`, filename: FILENAME, options: ACME },
    // `package.json` is always reachable.
    { code: `import x from '@acme/contracts/package.json';`, filename: FILENAME, options: ACME },
    // A scope that is not configured is ignored.
    { code: `import x from '@other/pkg/internal/deep';`, filename: FILENAME, options: ACME },
    // With no scopes the rule is inert.
    {
      code: `import x from '@acme/contracts/internal/secret';`,
      filename: FILENAME,
      options: [{ scopes: [] }],
    },
    // Outside any workspace, there is nothing to resolve against.
    {
      code: `import x from '@acme/contracts/internal/secret';`,
      filename: '/tmp/not-a-workspace/file.ts',
      options: ACME,
    },
  ],
  invalid: [
    // A subpath the package's `exports` does not expose.
    {
      code: `import x from '@acme/contracts/internal/secret';`,
      filename: FILENAME,
      options: ACME,
      errors: [{ messageId: 'subpathNotExported' }],
    },
    // An exact `./schemas` entry does not cover the deeper `./schemas/extra`.
    {
      code: `import x from '@acme/contracts/schemas/extra';`,
      filename: FILENAME,
      options: ACME,
      errors: [{ messageId: 'subpathNotExported' }],
    },
    // Re-export from an unexported subpath.
    {
      code: `export { y } from '@acme/contracts/internal/thing';`,
      filename: FILENAME,
      options: ACME,
      errors: [{ messageId: 'subpathNotExported' }],
    },
    // Dynamic import of an unexported subpath.
    {
      code: `const m = import('@acme/contracts/internal/thing');`,
      filename: FILENAME,
      options: ACME,
      errors: [{ messageId: 'subpathNotExported' }],
    },
  ],
});
