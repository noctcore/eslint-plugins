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
    // Statically off shell values.
    { code: 'spawn(`cmd ${x}`, [], { shell: undefined });', filename: TS },
    { code: "spawn(`cmd ${x}`, [], { shell: '' });", filename: TS },
    // A promisified runner with a static command, or an array-args runner without a shell.
    {
      code: "import { exec } from 'node:child_process'; import { promisify } from 'node:util'; const execAsync = promisify(exec); await execAsync('git status');",
      filename: TS,
    },
    {
      code: "import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; const run = promisify(execFile); await run('git', ['checkout', branch]);",
      filename: TS,
    },
    // promisify of something that is not a child_process runner.
    {
      code: "import { promisify } from 'node:util'; const readAsync = promisify(readFile); await readAsync(`${dir}/a.txt`);",
      filename: TS,
    },
    // A shadowing parameter is not the promisified binding.
    {
      code: "const execAsync = promisify(exec); function f(execAsync) { return execAsync(`x ${y}`); }",
      filename: TS,
    },
    // Guarded values: the function exits unless the value passed a check
    // that leaves no shell metacharacter.
    {
      code: "const SORTS = ['asc', 'desc']; function list(sort: string) { if (!SORTS.includes(sort)) return; exec(`ls --sort ${sort}`); }",
      filename: TS,
    },
    {
      code: "function run(bin: string) { if (!['ls', 'date'].includes(bin)) { log('no'); return; } const allowed = bin; execSync('echo ' + allowed); }",
      filename: TS,
    },
    {
      code: "const ALLOWED = new Set(['a', 'b']); function run(x: string) { if (!ALLOWED.has(x)) throw new Error('bad'); exec(`tool ${x}`); }",
      filename: TS,
    },
    {
      code: "function run(x: string) { if (x !== 'fast' && x !== 'slow') return; exec(`tool --mode ${x}`); }",
      filename: TS,
    },
    {
      code: "function run(x: string) { if (x === 'fast' || x === 'slow') { exec(`tool --mode ${x}`); } }",
      filename: TS,
    },
    {
      code: "function run(raw: string) { const name = decodeURIComponent(raw); if (!/^(asc|desc|name)$/.test(String(name))) { return; } const picked = name; spawn('echo ' + picked, { shell: true }); }",
      filename: TS,
    },
    {
      code: "const SAFE = /^[a-zA-Z0-9 _.%\\-]+$/; function run(x: string) { if (!SAFE.test(x)) return; execSync('echo ' + x); }",
      filename: TS,
    },
    {
      code: "function run(x: string) { if (!/^\\w+$/u.test(x) || x.length > 20) return; exec(`echo ${x}`); }",
      filename: TS,
    },
    {
      code: "function run(input: string) { let x; try { x = JSON.parse(input).v; } catch { x = input; } if (!['ls', 'cat'].includes(x)) return; const bin = x; exec('echo ' + bin); }",
      filename: TS,
    },
    // A schema whose pattern is anchored and shell-inert.
    {
      code: "const schema = joi.string().pattern(/^[a-z0-9_-]+$/).required(); function run(x: string) { const { error, value } = schema.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
    },
    {
      code: "const Mode = z.enum(['fast', 'slow']); function run(x: string) { const mode = Mode.parse(x); exec(`tool ${mode}`); }",
      filename: TS,
    },
    // Values the operator sets, and in-file constants.
    { code: "exec('git -C ' + process.env.REPO_DIR);", filename: TS },
    {
      code: "const dir = String(process.env.APP_DIR || '').replace(/\\0/g, ''); exec(`ls ${dir}`);",
      filename: TS,
    },
    { code: "const BIN = '/usr/bin/git'; exec(`${BIN} status`);", filename: TS },
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
    // A promisified exec, the usual async form.
    {
      code: "import { exec } from 'node:child_process'; import { promisify } from 'node:util'; const execAsync = promisify(exec); export async function checkout(b: string) { await execAsync(`git checkout ${b}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation', data: { callee: 'execAsync' } }],
    },
    // util.promisify on a child_process member.
    {
      code: "import * as cp from 'node:child_process'; import util from 'node:util'; const sh = util.promisify(cp.exec); sh('ls ' + dir);",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A promisified execFile with a shell option.
    {
      code: "const run = promisify(execFile); run(`git ${b}`, { shell: true });",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A shell decided at run time is a shell on some machine (Windows here).
    {
      code: "spawn(`git ${b}`, { shell: process.platform === 'win32' });",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'spawnSync(`git ${b}`, [], { shell });',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "execFile(`git ${b}`, [], { shell: useShell as boolean });",
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
    // Near misses of a guard keep the report.
    {
      code: "function run(x: string) { exec(`echo ${x}`); if (!['a'].includes(x)) return; }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!['a', 'b'].includes(x)) { log('bad'); } exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string, y: string) { if (!['a', 'b'].includes(y)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string, list: string[]) { if (!list.includes(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/[a-z]+/.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/^[a-z]+$/m.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/^[\\w\\s]+$/.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/^.+$/.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/^[a-z;]+$/.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (!/^a$|^b/.test(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(input: string) { let x = input; if (!['a'].includes(x)) return; x = input + ';'; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(input: string) { let x = 'a'; const copy = x; x = input; if (!['a'].includes(x)) return; exec(`echo ${copy}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(x: string) { if (['a', 'b'].includes(x)) { log(x); } else { exec(`echo ${x}`); } }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const schema = joi.string().pattern(/^.+$/); function run(x: string) { const { error, value } = schema.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const schema = joi.string().pattern(/^[a-z]+$/); function run(x: string) { const { value } = schema.validate(x); exec('echo ' + value); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // One guarded part does not cover an unguarded one.
    {
      code: "function run(x: string, y: string) { if (!['a'].includes(x)) return; exec(`echo ${x} ${y}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // Only `process.env` reads are the operator's; other globals are not.
    {
      code: "exec('git -C ' + config.repoDir);",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "exec('git -C ' + process.env.REPO_DIR + userInput);",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
  ],
});
