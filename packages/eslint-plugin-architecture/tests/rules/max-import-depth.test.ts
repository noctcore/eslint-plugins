import { ruleTester } from '@noctcore/eslint-test-utils';

import { maxImportDepthRule } from '../../src/rules/max-import-depth';

const ALIAS_SRC = [{ alias: { src: '@' } }] as const;

ruleTester.run('max-import-depth', maxImportDepthRule, {
  valid: [
    // At the default limit (3) — allowed.
    { code: `import x from '../../../shared';`, filename: 'src/a/b/c/d.ts' },
    // No climb.
    { code: `import x from './local';`, filename: 'src/a.ts' },
    // Alias / bare-package imports never climb.
    { code: `import x from '@/shared';`, filename: 'src/a/b/c/d.ts' },
    { code: `import x from 'react';`, filename: 'src/a.ts' },
    // A raised `max` permits deeper climbs.
    {
      code: `import x from '../../../../shared';`,
      filename: 'src/a/b/c/d/e.ts',
      options: [{ max: 4 }],
    },
    // A re-export at the limit is fine.
    { code: `export { y } from '../../../shared';`, filename: 'src/a/b/c/d.ts' },
  ],
  invalid: [
    // Over the default limit, no alias configured — reported, no fix.
    {
      code: `import x from '../../../../shared/log';`,
      filename: 'src/a/b/c/d/deep.ts',
      errors: [{ messageId: 'tooDeep' }],
    },
    // Over the limit with an alias anchor on the resolved path — autofixed.
    {
      code: `import x from '../../../../shared/log';`,
      filename: 'src/a/b/c/d/deep.ts',
      options: ALIAS_SRC,
      output: `import x from '@/shared/log';`,
      errors: [{ messageId: 'tooDeep' }],
    },
    // Dynamic import over the limit is also caught.
    {
      code: `const m = import('../../../../shared/log');`,
      filename: 'src/a/b/c/d/deep.ts',
      options: ALIAS_SRC,
      output: `const m = import('@/shared/log');`,
      errors: [{ messageId: 'tooDeep' }],
    },
    // `export * from` over the limit, aliased.
    {
      code: `export * from '../../../../shared/log';`,
      filename: 'src/a/b/c/d/deep.ts',
      options: ALIAS_SRC,
      output: `export * from '@/shared/log';`,
      errors: [{ messageId: 'tooDeep' }],
    },
    // Over the limit but the alias anchor is absent — reported without a fix.
    {
      code: `import x from '../../../../elsewhere';`,
      filename: 'src/a/b/c/d/deep.ts',
      options: [{ alias: { nonexistent: '@' } }],
      errors: [{ messageId: 'tooDeep' }],
    },
  ],
});
