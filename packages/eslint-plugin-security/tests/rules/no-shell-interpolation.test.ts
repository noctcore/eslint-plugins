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
      code: 'const execAsync = promisify(exec); function f(execAsync) { return execAsync(`x ${y}`); }',
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
      code: "const SAFE = /^[a-zA-Z0-9_.%][a-zA-Z0-9_.%\\-]*$/; function run(x: string) { if (!SAFE.test(x)) return; execSync('echo ' + x); }",
      filename: TS,
    },
    {
      code: 'function run(x: string) { if (!/^\\w+$/u.test(x) || x.length > 20) return; exec(`echo ${x}`); }',
      filename: TS,
    },
    {
      code: "function run(input: string) { let x; try { x = JSON.parse(input).v; } catch { x = input; } if (!['ls', 'cat'].includes(x)) return; const bin = x; exec('echo ' + bin); }",
      filename: TS,
    },
    // A schema whose pattern is anchored and shell-inert.
    {
      code: "import joi from 'joi'; const schema = joi.string().pattern(/^[a-z0-9_]+$/).required(); function run(x: string) { const { error, value } = schema.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const Mode = z.enum(['fast', 'slow']); function run(x: string) { const mode = Mode.parse(x); exec(`tool ${mode}`); }",
      filename: TS,
    },
    // A require root, a const chain read under the allowlist, a dash after a pinned first character, a parsed object only read.
    {
      code: "const Joi = require('joi'); const S = Joi.string().pattern(/^[a-z]+$/); function run(x: string) { const { error, value } = S.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const base = z.string().min(1); const S = base.regex(/^[a-z]+$/); function run(x: string) { exec(`tool ${S.parse(x)}`); }",
      filename: TS,
    },
    {
      code: 'const SAFE = /^[a-z][a-z0-9-]*$/; function run(x: string) { if (!SAFE.test(x)) return; exec(`tool ${x}`); }',
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown) { const parsed = Body.parse(x); log(parsed.theme); exec(`tool ${parsed.theme}`); }",
      filename: TS,
    },
    // A value glued to text before it in the same word may start with `-`.
    {
      code: "const RE = /^[\\w.-]+$/; function run(author: string) { if (!RE.test(author)) return; exec('git log --author=' + author); }",
      filename: TS,
    },
    {
      code: "const RE = /^[\\w.-]+$/; function run(ref: string) { if (!RE.test(ref)) return; exec(`git show origin/${ref}`); }",
      filename: TS,
    },
    // Values the operator sets, with `trustEnvironment`, and in-file constants.
    {
      code: "exec('git -C ' + process.env.REPO_DIR);",
      filename: TS,
      options: [{ trustEnvironment: true }],
    },
    {
      code: "exec('git -C ' + process.env['REPO_DIR']);",
      filename: TS,
      options: [{ trustEnvironment: true }],
    },
    {
      code: "const dir = String(process.env.APP_DIR || '').replace(/\\0/g, ''); exec(`ls ${dir}`);",
      filename: TS,
      options: [{ trustEnvironment: true }],
    },
    // A list used only by `includes` / `has`, also through `new Set(list)`.
    {
      code: "const MODES = ['fast', 'slow']; const SET = new Set(MODES); function run(x: string) { if (!SET.has(x)) return; if (!MODES.includes(x)) return; exec(`tool ${x}`); }",
      filename: TS,
    },
    // A check inside the callback that runs the command.
    {
      code: 'function run(items: string[]) { items.forEach((x) => { if (!/^[a-z]+$/.test(x)) return; exec(`echo ${x}`); }); }',
      filename: TS,
    },
    // Loose equality against a string literal.
    { code: "function run(x: string) { if (x == 'a') { exec(`echo ${x}`); } }", filename: TS },
    // A schema `regex` with a message.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/, 'letters only').max(20); function run(x: string) { exec(`tool ${S.parse(x)}`); }",
      filename: TS,
    },
    { code: "const BIN = '/usr/bin/git'; exec(`${BIN} status`);", filename: TS },
    // A frozen list, `indexOf`, and a comparison with a `const` string.
    {
      code: "const MODES = Object.freeze(['fast', 'slow']); export const ALL = MODES; function run(x: string) { if (!MODES.includes(x)) return; exec(`tool ${x}`); }",
      filename: TS,
    },
    {
      code: "const MODES = ['fast', 'slow']; function run(x: string) { if (MODES.indexOf(x) === -1) return; exec(`tool ${x}`); }",
      filename: TS,
    },
    {
      code: "const FAST = 'fast'; function run(x: string) { if (x !== FAST) return; exec(`tool ${x}`); }",
      filename: TS,
    },
    // zod `safeParse`, and a field of a parsed object schema.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string) { const r = S.safeParse(x); if (!r.success) return; exec(`tool ${r.data}`); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['fast', 'slow']) }); function run(body: unknown) { exec(`tool ${Body.parse(body).mode}`); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.string().regex(/^[a-z]+$/) }).strict(); function run(body: unknown) { const { mode } = Body.parse(body); exec(`tool ${mode}`); }",
      filename: TS,
    },
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
      code: 'const run = promisify(execFile); run(`git ${b}`, { shell: true });',
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
      code: 'execFile(`git ${b}`, [], { shell: useShell as boolean });',
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
      code: 'function run(x: string, list: string[]) { if (!list.includes(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/[a-z]+/.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/^[a-z]+$/m.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/^[\\w\\s]+$/.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/^.+$/.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/^[a-z;]+$/.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(x: string) { if (!/^a$|^b/.test(x)) return; exec(`echo ${x}`); }',
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
      code: "import joi from 'joi'; const schema = joi.string().pattern(/^.+$/); function run(x: string) { const { error, value } = schema.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import joi from 'joi'; const schema = joi.string().pattern(/^[a-z]+$/); function run(x: string) { const { value } = schema.validate(x); exec('echo ' + value); }",
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
    // The environment is not trusted by default: in CI it can carry a branch name an outsider chose.
    {
      code: 'exec(`git checkout ${process.env.GITHUB_HEAD_REF}`);',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // With trust on, a computed key is still not the operator's.
    {
      code: 'function run(k: string) { exec(`git -C ${process.env[k]}`); }',
      filename: TS,
      options: [{ trustEnvironment: true }],
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A hoisted function can run before the check above its definition.
    {
      code: "function h(x: string) { run(); if (!['a'].includes(x)) return; function run() { exec(`echo ${x}`); } }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A nested function that writes the checked binding can run after the check.
    {
      code: "function h(x: string, evil: string) { const reset = () => { x = evil; }; if (!['a'].includes(x)) return; reset(); exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `const` fixes the binding, not the list: a list that is changed anywhere does not count.
    {
      code: "const ALLOWED = ['a']; function h(x: string) { ALLOWED.push(x); if (!ALLOWED.includes(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const ALLOWED = ['a']; function h(x: string) { ALLOWED[0] = x; if (!ALLOWED.includes(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const ALLOWED = new Set(['a']); export function add(v: string) { ALLOWED.add(v); } function h(x: string) { if (!ALLOWED.has(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "export const ALLOWED = ['a']; function h(x: string) { if (!ALLOWED.includes(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // Schema methods that can let another value through.
    {
      code: "import joi from 'joi'; const S = joi.string().pattern(/^[a-z]+$/, { invert: true }); function h(x: string) { const { error, value } = S.validate(x); if (error) return; exec(`echo ${value}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import joi from 'joi'; const S = joi.string().pattern(/^[a-z]+$/).failover(y); function h(x: string) { const { error, value } = S.validate(x); if (error) return; exec(`echo ${value}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/).catch(y); function h(x: string) { exec(`echo ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/).default(y); function h(x: string) { exec(`echo ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/).pipe(z.string().overwrite((v) => v + y)); function h(x: string) { exec(`echo ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `[]` is an empty class in JavaScript, so this regex admits `.*`.
    {
      code: 'function h(x: string) { if (!/^([]|.*|[a])$/.test(x)) return; exec(`echo ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // Loose equality against a number admits `' 1\\n'`.
    {
      code: 'function h(x: string) { if (x == 1) { exec(`echo ${x}`); } }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A local `String` or `Set` is not the global one.
    {
      code: 'function h(x: string, String: (v: string) => string) { if (!/^[a-z]+$/.test(x)) return; exec(`echo ${String(x)}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "class Set { constructor(_: unknown) {} has() { return true; } } const OK = new Set(['a']); function h(x: string) { if (!OK.has(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // An array changed in place after the check no longer holds the checked text.
    {
      code: 'function h(x: string, y: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; parts.push(y); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `{00}` allows zero repetitions, so the value can start with `-` (an option).
    {
      code: 'function h(x: string) { if (!/^a{00}[-a-z]+$/.test(x)) return; exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `safeParse` without the exit, an unconfined field, a list that is not frozen and leaks.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string) { const r = S.safeParse(x); exec(`tool ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['fast']), name: z.string() }); function run(body: unknown) { exec(`tool ${Body.parse(body).name}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const MODES = ['fast']; export const ALL = MODES; function run(x: string) { if (MODES.indexOf(x) === -1) return; exec(`tool ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const MODES = ['fast']; function run(x: string) { if (MODES.indexOf(x) === 0) return; exec(`tool ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A parsed object changed after the parse: a fallback write, a field write, a computed write, a write through `result.data`, `Object.assign`, an alias.
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['fast', 'slow']) }); function run(req: any) { const body = Body.parse(req.body); if (!body.mode) body.mode = req.query.mode; exec(`run --mode ${body.mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown, evil: string) { const parsed = Body.parse(x); parsed.theme = evil; exec(`tool ${parsed.theme}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown, evil: string) { const parsed = Body.parse(x); parsed['theme'] = evil; exec(`tool ${parsed.theme}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown, evil: string) { const r = Body.safeParse(x); if (!r.success) return; r.data.theme = evil; exec(`tool ${r.data.theme}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown, evil: object) { const parsed = Body.parse(x); Object.assign(parsed, evil); exec(`tool ${parsed.theme}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ theme: z.enum(['dark']) }); function run(x: unknown, evil: string) { const parsed = Body.parse(x); const alias = parsed; alias.theme = evil; exec(`tool ${parsed.theme}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A field that a spread, a computed key or a later key of the same name can replace.
    {
      code: "import { z } from 'zod'; declare const baseShape: Record<string, never>; const Body = z.object({ mode: z.enum(['fast']), ...baseShape }); function run(x: unknown) { exec(`tool ${Body.parse(x).mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['fast']), mode: z.string() }); function run(x: unknown) { exec(`tool ${Body.parse(x).mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; declare const key: string; const Body = z.object({ mode: z.enum(['fast']), [key]: z.string() }); function run(x: unknown) { exec(`tool ${Body.parse(x).mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A schema chain whose root is not the zod or joi import: a parameter, a stored base with an unread method, another module.
    {
      code: "function run(schema: any, x: string) { const { error, value } = schema.pattern(/^[a-z]+$/).validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import Joi from 'joi'; declare const y: string; const base = Joi.string().allow(y).raw(); const S = base.pattern(/^[a-z]+$/); function run(x: string) { const { error, value } = S.validate(x); if (error) return; exec('echo ' + value); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from './my-zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string) { exec(`tool ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // Whitespace splits the value into arguments; a leading `-` is an option (CWE-88).
    {
      code: 'const SAFE = /^[\\w .-]+$/; function run(dir: string) { if (!SAFE.test(dir)) return; exec(`tar -czf out.tgz ${dir}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'const SAFE = /^[\\w.-]+$/; function run(dir: string) { if (!SAFE.test(dir)) return; exec(`tar -czf out.tgz ${dir}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // An imported live binding, which the other module can change after the check.
    {
      code: "import { cur, setCur } from './state'; function run(evil: string) { if (!['a', 'b'].includes(cur)) return; setCur(evil); exec(`tool ${cur}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A regex that is exported, recompiled or has `test` replaced.
    {
      code: 'export const RE = /^[a-z]+$/; function run(x: string) { if (!RE.test(x)) return; exec(`tool ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'const RE = /^[a-z]+$/; RE.test = () => true; function run(x: string) { if (!RE.test(x)) return; exec(`tool ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const RE = /^[a-z]+$/; RE.compile('.*'); function run(x: string) { if (!RE.test(x)) return; exec(`tool ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A shadowed `process` or `String` is not the environment.
    {
      code: "function run(process: { env: Record<string, string> }) { exec('git -C ' + process.env.REPO_DIR); }",
      filename: TS,
      options: [{ trustEnvironment: true }],
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(String: (v: unknown) => string) { exec('git -C ' + String(process.env.REPO_DIR)); }",
      filename: TS,
      options: [{ trustEnvironment: true }],
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A value after a space or an opening quote starts a word.
    {
      code: "const RE = /^[\\w.-]+$/; function run(host: string) { if (!RE.test(host)) return; exec('nslookup ' + host); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const RE = /^[\\w.-]+$/; function run(host: string) { if (!RE.test(host)) return; exec(`nslookup \"${host}\"`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A whole `result.data` changed: before the check, through `Object.assign`, a call, an alias, a destructuring target.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string, e: string) { const r = S.safeParse(x); r.data = e; if (!r.success) return; exec(`ls ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string, e: string) { const r = S.safeParse(x); if (!r.success) return; Object.assign(r, { data: e }); exec(`ls ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); declare function mutate(v: unknown): void; function run(x: string) { const r = S.safeParse(x); if (!r.success) return; mutate(r); exec(`ls ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string, e: string) { const r = S.safeParse(x); if (!r.success) return; const q = r; q.data = e; exec(`ls ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); function run(x: string, e: string) { const r = S.safeParse(x); if (!r.success) return; ({ v: r.data } = { v: e }); exec(`ls ${r.data}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A `-` or `+` right before the value does not glue it: `-${x}` with `x = '-output=f'` is a long option.
    {
      code: "const RE = /^[a-z-]+$/; function run(x: string) { if (!RE.test(x)) return; exec(`tool -${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const RE = /^[a-z-]+$/; function run(x: string) { if (!RE.test(x)) return; exec('tool +' + x); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
  ],
});
