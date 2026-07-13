import { ruleTester } from '@noctcore/eslint-test-utils';

import { filenameMatchesExportRule } from '../../src/rules/filename-matches-export';

ruleTester.run('filename-matches-export', filenameMatchesExportRule, {
  valid: [
    // Default export whose name matches the file exactly.
    { code: `export default function TaskCard() {}`, filename: 'src/TaskCard.tsx' },
    // Case/separator-insensitive match: kebab file ↔ camel export.
    { code: `export const useThing = () => {};`, filename: 'src/use-thing.ts' },
    // Pascal file ↔ pascal export via a class default.
    { code: `export default class Modal {}`, filename: 'src/Modal.tsx' },
    // Index files are always skipped.
    { code: `export default function Foo() {}`, filename: 'src/index.ts' },
    // Anonymous default — no identifier to compare — skipped.
    { code: `export default () => 1;`, filename: 'src/whatever.ts' },
    // Several named exports and no default — no single primary — skipped.
    { code: `export const a = 1;\nexport const b = 2;`, filename: 'src/pair.ts' },
    // No exports at all — skipped.
    { code: `const x = 1;`, filename: 'src/nothing.ts' },
    // A pure re-export has no local identity — skipped.
    { code: `export { Foo } from './Foo';`, filename: 'src/bar.ts' },
    // Default takes precedence over a named export and matches.
    {
      code: `export default function Widget() {}\nexport const helper = 1;`,
      filename: 'src/Widget.tsx',
    },
    // `ignore` glob skips the file.
    {
      code: `export const formatDate = () => {};`,
      filename: 'src/helpers.ts',
      options: [{ ignore: ['**/helpers.ts'] }],
    },
  ],
  invalid: [
    // Sole named export mismatches — suggestion renames the const to the stem.
    {
      code: `export const formatDate = () => {};`,
      filename: 'src/helpers.ts',
      errors: [
        {
          messageId: 'filenameMismatch',
          suggestions: [
            { messageId: 'renameExport', output: `export const helpers = () => {};` },
          ],
        },
      ],
    },
    // Default-exported function name mismatches the file.
    {
      code: `export default function Foo() {}`,
      filename: 'src/bar.ts',
      errors: [
        {
          messageId: 'filenameMismatch',
          suggestions: [
            { messageId: 'renameExport', output: `export default function bar() {}` },
          ],
        },
      ],
    },
    // Default-exported identifier: the binding and its reference both rename.
    {
      code: `const Thing = 1;\nexport default Thing;`,
      filename: 'src/other.ts',
      errors: [
        {
          messageId: 'filenameMismatch',
          suggestions: [
            {
              messageId: 'renameExport',
              output: `const other = 1;\nexport default other;`,
            },
          ],
        },
      ],
    },
    // Mismatch but the stem is not a valid identifier — reported without a suggestion.
    {
      code: `export const foo = 1;`,
      filename: 'src/2cool.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
  ],
});
