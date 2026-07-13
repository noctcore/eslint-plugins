import { ruleTester } from '@noctcore/eslint-test-utils';

import { indexMustReexportDefaultRule } from '../../src/rules/index-must-reexport-default';

// The Card/ fixture has a Card.tsx sibling on disk, so the rule activates for
// its index.ts (it only checks index.ts files next to a `<Folder>.tsx`).
const CARD_INDEX = 'tests/fixtures/components/Card/index.ts';

ruleTester.run('index-must-reexport-default', indexMustReexportDefaultRule, {
  valid: [
    {
      code: `export { default as Card } from './Card';`,
      filename: CARD_INDEX,
    },
    {
      code: `export { default } from './Card';\nexport * from './Card.types';`,
      filename: CARD_INDEX,
    },
    // A non-component-folder index.ts (folder not PascalCase) is untouched.
    {
      code: `export const config = 1;`,
      filename: 'tests/fixtures/lib/index.ts',
    },
    // A PascalCase folder with no `<Folder>.tsx` sibling on disk is not a
    // component barrel and is left untouched.
    {
      code: `export * from './Card.types';`,
      filename: 'apps/web/src/components/downloads/NoSibling/index.ts',
    },
    // A non-index file is never checked.
    {
      code: `export const x = 1;`,
      filename: 'tests/fixtures/components/Card/Card.helpers.ts',
    },
    // De-projecting: a matching `ignorePaths` glob suppresses the check.
    {
      code: `export * from './Card.types';`,
      filename: CARD_INDEX,
      options: [{ ignorePaths: ['**/Card/**'] }],
    },
  ],
  invalid: [
    {
      code: `export * from './Card.types';`,
      filename: CARD_INDEX,
      errors: [{ messageId: 'missingDefaultReexport' }],
    },
    // A non-matching `ignorePaths` glob does not suppress the check.
    {
      code: `export * from './Card.types';`,
      filename: CARD_INDEX,
      options: [{ ignorePaths: ['**/other/**'] }],
      errors: [{ messageId: 'missingDefaultReexport' }],
    },
  ],
});
