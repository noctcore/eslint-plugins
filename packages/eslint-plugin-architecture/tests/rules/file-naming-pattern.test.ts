import { ruleTester, workspacePath } from '@noctcore/eslint-test-utils';

import { fileNamingPatternRule } from '../../src/rules/file-naming-pattern';

const PATTERN = '^{folder}(\\.[a-z-]+)?\\.ts$';
const options = [{ folders: ['**/src/*'], pattern: PATTERN }];
const code = '// module\nexport const value = 1;\n';

ruleTester.run('file-naming-pattern', fileNamingPatternRule, {
  valid: [
    { name: 'folder-named file with a suffix is allowed', code, filename: 'src/account/account.routes.ts', options },
    { name: 'bare folder-named file is allowed', code, filename: 'src/account/account.ts', options },
    { name: 'only the immediate parent folder is tested', code, filename: 'src/account/nested/routes.ts', options },
    { name: 'file whose parent does not match is never reported', code, filename: 'lib/account/routes.ts', options },
    {
      name: 'folder name is escaped',
      code,
      filename: 'src/a.b/a.b.ts',
      options: [{ folders: ['**/src/*'], pattern: '^{folder}\\.ts$' }],
    },
    {
      name: 'allowIn exempts a file',
      code,
      filename: 'src/account/index.ts',
      options: [{ ...options[0], allowIn: ['**/index.ts'] }],
    },
    {
      name: 'relative folder glob does not match another app',
      code,
      filename: workspacePath('apps', 'web', 'src', 'account', 'routes.ts'),
      options: [{ folders: ['apps/api/src/*'], pattern: PATTERN }],
    },
    { name: 'no options reports nothing', code, filename: 'src/account/routes.ts' },
    {
      name: 'folders without pattern reports nothing',
      code,
      filename: 'src/account/routes.ts',
      options: [{ folders: ['**/src/*'] }],
    },
    {
      name: 'pattern without folders reports nothing',
      code,
      filename: 'src/account/routes.ts',
      options: [{ pattern: PATTERN }],
    },
  ],
  invalid: [
    {
      name: 'file not built from the folder name is reported',
      code,
      filename: 'src/account/routes.ts',
      options,
      errors: [
        {
          messageId: 'mismatch',
          line: 1,
          column: 1,
          data: { basename: 'routes.ts', folder: 'account', expected: '^account(\\.[a-z-]+)?\\.ts$' },
        },
      ],
    },
    {
      name: 'folder name is escaped before substitution',
      code,
      filename: 'src/a.b/aXb.ts',
      options: [{ folders: ['**/src/*'], pattern: '^{folder}\\.ts$' }],
      errors: [{ messageId: 'mismatch', data: { basename: 'aXb.ts', folder: 'a.b', expected: '^a\\.b\\.ts$' } }],
    },
    {
      name: 'a file named like an allowIn glob is reported without allowIn',
      code,
      filename: 'src/account/index.ts',
      options,
      errors: [{ messageId: 'mismatch' }],
    },
    {
      name: 'relative folder glob matches from the workspace root',
      code,
      filename: workspacePath('apps', 'api', 'src', 'account', 'routes.ts'),
      options: [{ folders: ['apps/api/src/*'], pattern: PATTERN }],
      errors: [{ messageId: 'mismatch' }],
    },
    {
      name: 'every placeholder is substituted',
      code,
      filename: 'src/account/account-account.ts',
      options: [{ folders: ['**/src/*'], pattern: '^{folder}\\.{folder}\\.ts$' }],
      errors: [{ messageId: 'mismatch', data: { basename: 'account-account.ts', folder: 'account', expected: '^account\\.account\\.ts$' } }],
    },
    {
      name: 'invalid pattern is a configuration problem',
      code,
      filename: 'src/account/routes.ts',
      options: [{ folders: ['**/src/*'], pattern: '^{folder}(' }],
      errors: [{ messageId: 'invalidPattern', line: 1, column: 1 }],
    },
  ],
});
