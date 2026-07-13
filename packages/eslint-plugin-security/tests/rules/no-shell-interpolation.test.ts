import { ruleTester } from '@noctcore/eslint-test-utils';

import { noShellInterpolationRule } from '../../src/rules/no-shell-interpolation';

const TS = 'runner.ts';

ruleTester.run('no-shell-interpolation', noShellInterpolationRule, {
  valid: [
    // The safe shape: program + args array, no shell.
    { code: `execFile('git', ['checkout', branch]);`, filename: TS },
    { code: `spawn('ls', [dir]);`, filename: TS },
    // A fully static command string.
    { code: `exec('ls -la');`, filename: TS },
    { code: 'exec(`ls -la`);', filename: TS },
    // A concatenation of only literals is static.
    { code: `exec('ls ' + '-la');`, filename: TS },
    // RegExp.prototype.exec must never false-positive.
    { code: 'pattern.exec(`${x}`);', filename: TS },
    { code: 're.exec(input);', filename: TS },
    // spawn WITHOUT shell:true is left alone even with a dynamic first arg.
    { code: 'spawn(`cmd ${x}`, [], { shell: false });', filename: TS },
    // Not a shell runner.
    { code: 'render(`hi ${name}`);', filename: TS },
  ],
  invalid: [
    // exec with an interpolated template.
    {
      code: 'exec(`git checkout ${branch}`);',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // execSync likewise.
    {
      code: 'execSync(`rm -rf ${dir}`);',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A `+` concatenation with a dynamic part.
    {
      code: `exec('ls ' + dir);`,
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A member call on a child_process alias.
    {
      code: 'cp.exec(`ls ${d}`);',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'childProcess.exec(`ls ${d}`);',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // spawn WITH shell:true and a dynamic command.
    {
      code: 'spawn(`cmd ${x}`, { shell: true });',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // execFile with shell:true is no longer safe.
    {
      code: 'execFile(`cmd ${x}`, [], { shell: true });',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A configured extra callee is treated as an always-shell runner.
    {
      code: 'runShell(`ls ${d}`);',
      filename: TS,
      options: [{ extraCallees: ['runShell'] }],
      errors: [{ messageId: 'shellInterpolation' }],
    },
  ],
});
