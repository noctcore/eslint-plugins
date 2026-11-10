import { ruleTester, workspacePath } from '@noctcore/eslint-test-utils';

import { noProcessExitRule } from '../../src/rules/no-process-exit';

// Globs are `**/`-prefixed so they match regardless of whether ESLint reports
// the file with an absolute or a project-relative path.
const options = [{ allowIn: ['**/scripts/**', '**/bin/**'] }] as const;

ruleTester.run('no-process-exit', noProcessExitRule, {
  valid: [
    // A repo-relative glob matches the absolute filename ESLint passes, read
    // relative to the workspace root (or the working directory).
    {
      code: 'process.exit(1);',
      filename: workspacePath('apps', 'server', 'src', 'env.ts'),
      options: [{ allowIn: ['apps/server/**'] }],
    },
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
    // A repo-relative glob matches the absolute filename ESLint passes, read
    // relative to the workspace root (or the working directory).
    {
      code: 'process.exit(1);',
      filename: workspacePath('apps', 'web', 'src', 'env.ts'),
      options: [{ allowIn: ['apps/server/**'] }],
      errors: [{ messageId: 'processExit' }],
    },
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
