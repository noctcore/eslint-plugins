import { ruleTester } from '@noctcore/eslint-test-utils';

import { interfacePrefixIRule } from '../../src/rules/interface-prefix-i';

const FILE = 'src/hooks/use-auth.ts';

ruleTester.run('interface-prefix-i', interfacePrefixIRule, {
  valid: [
    { code: `interface IUserProfile { id: string; }`, filename: FILE },
    // Module augmentation: name is dictated by the augmented module.
    {
      code: `declare module '@tanstack/react-router' { interface Register { router: unknown; } }`,
      filename: 'src/main.tsx',
    },
    // Global augmentation.
    {
      code: `declare global { interface Window { electron: unknown; } }\nexport {};`,
      filename: 'src/types/electron.d.ts',
    },
  ],
  invalid: [
    {
      code: `interface UserProfile { id: string; }`,
      filename: FILE,
      errors: [{ messageId: 'missingPrefix' }],
    },
    // `I` followed by a lowercase letter does not satisfy the I[A-Z] prefix.
    {
      code: `interface Input { value: string; }`,
      filename: FILE,
      errors: [{ messageId: 'missingPrefix' }],
    },
  ],
});
