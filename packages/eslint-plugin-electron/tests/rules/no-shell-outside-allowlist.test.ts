import { ruleTester } from '@noctcore/eslint-test-utils';

import { noShellOutsideAllowlistRule } from '../../src/rules/no-shell-outside-allowlist';

const ALLOW = [{ allowIn: ['**/src/main/security.ts'] }];

ruleTester.run('no-shell-outside-allowlist', noShellOutsideAllowlistRule, {
  valid: [
    // The one module that owns it.
    { code: `import { shell } from 'electron';\nshell.openExternal(url);`, filename: 'apps/desktop/src/main/security.ts', options: ALLOW },
    { code: `import { app, BrowserWindow } from 'electron';`, filename: 'src/main/window.ts', options: ALLOW },
    // Some other `shell`.
    { code: `import { shell } from 'shelljs';\nshell.exec('ls');`, filename: 'src/main/window.ts', options: ALLOW },
    { code: `const { shell } = config;\nterminal.shell;`, filename: 'src/main/window.ts', options: ALLOW },
    { code: `import electron from 'electron';\nconst { app } = electron;`, filename: 'src/main/window.ts', options: ALLOW },
  ],
  invalid: [
    {
      code: `import { app, shell } from 'electron';\nshell.openExternal(url);`,
      filename: 'apps/desktop/src/main/window.ts',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist', line: 1 }],
    },
    {
      code: `import { shell as sh } from 'electron';`,
      filename: 'src/main/window.ts',
      errors: [{ messageId: 'shellOutsideAllowlist' }],
    },
    {
      code: `import electron from 'electron';\nelectron.shell.openPath(file);`,
      filename: 'src/main/window.ts',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist', line: 2 }],
    },
    {
      code: `import * as electron from 'electron';\nconst { shell } = electron;`,
      filename: 'src/main/window.ts',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist' }],
    },
    {
      code: `const { shell } = require('electron');`,
      filename: 'src/main/window.js',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist' }],
    },
    {
      code: `require('electron').shell.openExternal(url);`,
      filename: 'src/main/window.js',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist' }],
    },
    {
      code: `const electron = require('electron');\nelectron.shell.beep();`,
      filename: 'src/main/window.js',
      options: ALLOW,
      errors: [{ messageId: 'shellOutsideAllowlist' }],
    },
  ],
});
