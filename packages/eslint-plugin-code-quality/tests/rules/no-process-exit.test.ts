import { ruleTester } from '@noctcore/eslint-test-utils';

import { noProcessExitRule } from '../../src/rules/no-process-exit';

// Globs are `**/`-prefixed so they match regardless of whether ESLint reports
// the file with an absolute or a project-relative path.
const options = [{ allowIn: ['**/scripts/**', '**/bin/**'] }] as const;

ruleTester.run('no-process-exit', noProcessExitRule, {
  valid: [
    // Allowlisted CLI/bootstrap files may exit.
    {
      code: 'process.exit(1);',
      filename: 'scripts/bump-version.mjs',
      options,
    },
    {
      code: 'process.exit(0);',
      filename: 'packages/tool/bin/run.ts',
      options,
    },
    // The built-in defaults also cover config files.
    {
      code: 'process.exit(0);',
      filename: 'vitest.config.ts',
    },
    // Not process.exit.
    {
      code: 'queue.exit(0);',
      filename: 'src/lib/queue.ts',
      options,
    },
  ],
  invalid: [
    {
      code: 'process.exit(1);',
      filename: 'src/lib/player.ts',
      options,
      errors: [{ messageId: 'processExit' }],
    },
    // Computed callee must not bypass the rule.
    {
      code: "process['exit'](0);",
      filename: 'src/lib/player.ts',
      options,
      errors: [{ messageId: 'processExit' }],
    },
  ],
});
