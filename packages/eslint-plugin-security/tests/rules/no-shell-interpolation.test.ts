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
      // With `%` the same regex is reported (#313): `cmd.exe` expands `%VAR%`.
      code: "const SAFE = /^[a-zA-Z0-9_.][a-zA-Z0-9_.\\-]*$/; function run(x: string) { if (!SAFE.test(x)) return; execSync('echo ' + x); }",
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
      code: "const RE = /^[\\w-][\\w.-]*$/; function run(ref: string) { if (!RE.test(ref)) return; exec(`git show origin/${ref}`); }",
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
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`ls 2>&1 ${t}`); exec(`ls >&2 ${t}`); }",
      filename: TS,
    },
    // Redirects and words that only look like wrappers keep an argument an argument; a constant is read as its text.
    {
      code: 'function run(x: string) { if (!/^[a-z]+$/.test(x)) return; exec(`ls 2>&1 ${x}`); exec(`ls -la ${x} &> out`); exec(`find . -name ${x}`); exec(`echo sudo ${x}`); }',
      filename: TS,
    },
    {
      code: "const FLAGS = '--color'; function run(x: string) { if (!/^[a-z]+$/.test(x)) return; exec(`ls ${FLAGS} ${x}`); }",
      filename: TS,
    },
    {
      code: "const DBS = ['orders']; function run(db: string) { if (!DBS.includes(db)) return; const target = `/var/backups/${db}.sql`; exec(`pg_dump ${db} > ${target}`); }",
      filename: TS,
    },
    // A schema used only by running it, building on it, or inside another schema that is only run.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); const B = z.object({ m: S }); function f(i: unknown) { exec(`ls ${S.parse(i)} ${B.parse(i).m}`); exec(`ls ${S.min(1).parse(i)}`); }",
      filename: TS,
    },
    // A program name from a literal allowlist, an argument from a regex.
    {
      code: "const TOOLS = ['git', 'ls']; function h(t: string, f: string) { if (!TOOLS.includes(t) || !/^[a-z]+$/.test(f)) return; exec(`${t} ${f}`); exec(`cd /tmp && ${t} -x`); }",
      filename: TS,
    },
    // A direct `eval` before the check.
    {
      code: 'function h(x: string) { eval("1"); if (!/^[a-z]+$/.test(x)) return; exec(`ls ${x}`); }',
      filename: TS,
    },
    // A schema read in a type or in another schema.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); type T = z.infer<typeof S>; function run(x: T) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; const Mode = z.enum(['a', 'b']); const Body = z.object({ mode: Mode }); function run(b: unknown) { exec(`tool ${Body.parse(b).mode}`); exec(`${Mode.parse(b)} --x`); }",
      filename: TS,
    },
    // A checked string handed to a function, or read through an alias, is still the checked text.
    {
      code: 'declare function log(v: unknown): void; function h(x: string) { if (!/^[a-z]+$/.test(x)) return; log(x); const safe = x; exec(`ls ${safe}`); }',
      filename: TS,
    },
    // An outer binding checked in a nested function, never written after its declaration.
    {
      code: 'let x = input(); async function h() { if (!/^[a-z]+$/.test(x)) return; await null; exec(`ls ${x}`); }',
      filename: TS,
    },
    // In strict code `arguments` does not alias the parameters.
    {
      code: 'function h(x: string, y: string) { if (!/^[a-z]+$/.test(x)) return; arguments[0] = y; exec(`ls ${x}`); }',
      filename: TS,
    },
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
    // The same array changed after the check by a helper, through an alias (made before or after the check) or `Object.assign` / `Reflect.set`.
    {
      code: 'declare function mutate(a: unknown, b: string): void; function h(x: string, y: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; mutate(parts, y); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, y: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; const p = parts; p.push(y); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, y: string) { const parts = [x]; const p = parts; if (!/^[a-z,]+$/.test(String(parts))) return; p.push(y); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, y: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; Object.assign(parts, [y]); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, y: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; Reflect.set(parts, 0, y); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'declare function keep(o: object): void; function h(x: string) { const parts = [x]; if (!/^[a-z,]+$/.test(String(parts))) return; keep({ parts }); exec(`echo ${parts}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A list or `Set` changed through another `const` name for it.
    {
      code: "const A = ['a']; const B = A; function h(x: string) { A.push(x); if (!B.includes(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const A = new Set(['a']); const B = A; function h(x: string) { A.add(x); if (!B.has(x)) return; exec(`echo ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // An outer binding checked in a nested function: the function runs between writes the outer code makes (hoisted, or resumed after an `await`).
    {
      code: "let x = 'a'; for (const i of inputs) { x = i; void h(); } async function h() { if (!/^[a-z]+$/.test(x)) return; await null; exec(`ls ${x}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'void h(); var x = evil; async function h() { if (!/^[a-z]+$/.test(x)) return; await null; exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `{00}` allows zero repetitions, so the value can start with `-` (an option).
    {
      code: 'function h(x: string) { if (!/^a{00}[-a-z]+$/.test(x)) return; exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // In sloppy mode `arguments[0] = y` writes the parameter `x`.
    {
      code: 'function h(x, y) { if (!/^[a-z]+$/.test(x)) return; arguments[0] = y; exec(`ls ${x}`); }',
      filename: 'runner.js',
      languageOptions: { parserOptions: { sourceType: 'script' } },
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A value that names the program is proven by a literal allowlist only: a regex admits `reboot` or `sh`.
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; execSync(`${tool}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string, file: string) { if (!/^[a-z]+$/.test(tool) || !/^[a-z]+$/.test(file)) return; exec(`${tool} ${file}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`cd /tmp && ${tool} -x`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`ls; ${tool}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`/usr/bin/${tool} --help`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`sudo ${tool}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`LANG=C ${tool}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Tool = z.string().regex(/^[a-z]+$/); function h(t: string) { exec(`${Tool.parse(t)} --version`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A regex that admits the empty string: `rm -rf /srv/` with an empty value.
    {
      code: 'function h(x: string) { if (!/^[a-z]*$/.test(x)) return; exec(`rm -rf /srv/${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string) { if (!/^([a-z]+)?$/.test(x)) return; exec(`tool --in ${x} --out f`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A global the config declares writable can be reassigned across the `await`.
    {
      code: 'async function h() { if (!/^[a-z]+$/.test(x)) return; await null; exec(`ls ${x}`); }',
      filename: TS,
      languageOptions: { globals: { x: 'writable' } },
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A direct `eval` after the check can assign the checked binding.
    {
      code: 'function h(x: string, s: string) { if (!/^[a-z]+$/.test(x)) return; eval(s); exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'let x = input(); function h(s: string) { if (!/^[a-z]+$/.test(x)) return; exec(`ls ${x}`); } function g(s: string) { eval(s); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A schema changed after its declaration, through a property, `Object.assign`, `delete`, a helper, or at the zod root.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); S.parse = (v: string) => v; function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); Object.assign(S, { parse: (v: string) => v }); function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; declare function patch(s: unknown): void; const S = z.string().regex(/^[a-z]+$/); patch(S); function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['a']) }); Body.shape.mode = z.string(); function run(b: unknown) { exec(`tool ${Body.parse(b).mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const Body = z.object({ mode: z.enum(['a']) }); delete Body.shape.mode; function run(b: unknown) { exec(`tool ${Body.parse(b).mode}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; (z as any).string = () => ({ regex: () => ({ parse: (v: string) => v }) }); const S = z.string().regex(/^[a-z]+$/); function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; export const S = z.string().regex(/^[a-z]+$/); function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); const T = S; T.parse = (v: string) => v; function run(x: string) { exec(`ls ${S.parse(x)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // After a wrapper every later word runs as a program, options included; wrappers match by basename and without quotes.
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`sudo -u x ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`sudo -- ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`doas -u x ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`env -i ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`env -- ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`nice -n 5 ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`timeout 30 ${t} /srv/app`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`echo a | xargs -0 ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`stdbuf -oL ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`time -p ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`/usr/bin/env ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`/usr/bin/sudo ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`'sudo' ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec('sudo -u deploy ' + t + ' /srv/app'); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // More wrappers, `find -exec`, package runners, and a redirect before the program.
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`eval ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`sh -c ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`bash -c '${t}'`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`source ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`. ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`coproc ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`setsid ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`chroot / ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`ionice ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`strace ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`watch ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`find . -exec ${t} {} +`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`ssh host ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`npx ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`pnpm dlx ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`>out ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`2>/dev/null ${t}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A separator or wrapper held in an in-file constant is read as its text.
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; const P = 'sudo'; exec(P + ' ' + t); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; const P = 'sudo'; exec(`${P} ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; const SEP = ';'; exec(`ls ${SEP} ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A direct `eval` behind a type-only wrapper.
    {
      code: 'function h(x: string, s: string) { if (!/^[a-z]+$/.test(x)) return; eval!(s); exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, s: string) { if (!/^[a-z]+$/.test(x)) return; (eval as any)(s); exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, s: string) { if (!/^[a-z]+$/.test(x)) return; (eval satisfies (s: string) => unknown)(s); exec(`ls ${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: 'function h(x: string, s: string) { if (!/^[a-z]+$/.test(x)) return; (<any>eval)(s); exec(`ls ${x}`); }',
      filename: TS,
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: false } } },
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A path segment glued after a `/` must not be `.` or `..`.
    {
      code: 'function h(x: string) { if (!/^[a-z.]+$/.test(x)) return; exec(`rm -rf /srv/${x}`); }',
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A schema changed through a schema that holds it, below its first property, or at the zod root.
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); const B = z.object({ m: S }); B.shape.m.parse = (v: any) => v; function f(i: unknown) { exec(`ls ${S.parse(i)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); S._def.checks.pop(); function f(i: unknown) { exec(`ls ${S.parse(i)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; declare function clear(v: unknown): void; const S = z.string().regex(/^[a-z]+$/); clear(S._def); function f(i: unknown) { exec(`ls ${S.parse(i)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; const S = z.string().regex(/^[a-z]+$/); const d = S._def; d.checks = []; function f(i: unknown) { exec(`ls ${S.parse(i)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "import { z } from 'zod'; (z.ZodString.prototype as any).parse = (v: any) => v; const S = z.string().regex(/^[a-z]+$/); function f(i: unknown) { exec(`ls ${S.parse(i)}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // `NAME=value` holding a value is still before the program, so the next word runs.
    {
      code: "function run(v: string, t: string) { if (!['production', 'test'].includes(v)) return; if (!/^[a-z]+$/.test(t)) return; exec(`NODE_ENV=${v} ${t} --version`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(v: string, t: string) { if (!['production', 'test'].includes(v)) return; if (!/^[a-z]+$/.test(t)) return; exec('NODE_ENV=' + v + ' ' + t + ' --version'); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(v: string, t: string) { if (!['production', 'test'].includes(v)) return; if (!/^[a-z]+$/.test(t)) return; exec(`A=${v} sudo ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "const N = 3; function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`N=${N} ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // A value that forms the name, and bash's `+=` and `[i]=` forms, are still assignments.
    {
      code: "function run(name: string, value: string, t: string) { if (!['A', 'B'].includes(name) || !['x', 'y'].includes(value)) return; if (!/^[a-z]+$/.test(t)) return; exec(`${name}=${value} ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(p: string, t: string) { if (!['A', 'B'].includes(p)) return; if (!/^[a-z]+$/.test(t)) return; exec(`A${p}=x ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(p: string, t: string) { if (!['A', 'B'].includes(p)) return; if (!/^[a-z]+$/.test(t)) return; exec(`${p}B=x ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`A+=x ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(v: string, t: string) { if (!['x', 'y'].includes(v)) return; if (!/^[a-z]+$/.test(t)) return; exec(`A+=${v} ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`A[0]=x ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(tool: string) { if (!/^[a-z]+$/.test(tool)) return; exec(`PATH+=:/opt/bin ${tool}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    // dash (Node's `/bin/sh` on Debian and Ubuntu) reads `&>` as `&`, then a redirect before the next program.
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`ls &>/dev/null ${t}`); }",
      filename: TS,
      errors: [{ messageId: 'shellInterpolation' }],
    },
    {
      code: "function run(t: string) { if (!/^[a-z]+$/.test(t)) return; exec(`ls&>/dev/null ${t}`); }",
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

/** A function whose `t` passed a shell-inert regex check before `body` runs. */
const checked = (body: string, params = 't: string'): string =>
  `function run(${params}) { if (!/^[a-z][a-z0-9-]*$/.test(t)) return; ${body} }`;
const error = [{ messageId: 'shellInterpolation' as const }];

// How the command text around a proven value is read (#313 to #321).
ruleTester.run('no-shell-interpolation reading', noShellInterpolationRule, {
  valid: [
    // #313: a regex that refuses `%` (cmd.exe expands `%VAR%`).
    { code: checked('exec(`echo ${t}`);'), filename: TS },
    // #314: a `+` admitted only after the first character, or glued to text before it.
    { code: 'function run(x: string) { if (!/^[a-z][\\w.+]*$/.test(x)) return; exec(`dig ${x} example.com`); }', filename: TS },
    { code: 'function run(x: string) { if (!/^[\\w+]+$/.test(x)) return; exec(`tool --tag=${x}`); }', filename: TS },
    // #315: static args, a proven arg, or no shell.
    { code: 'spawn(\'ls\', [\'-la\'], { shell: true });', filename: TS },
    { code: 'spawn(\'ls\', [dir], { shell: false });', filename: TS },
    { code: 'spawn(\'ls\', { shell: true });', filename: TS },
    { code: 'function run(d: string) { if (!/^[a-z]+$/.test(d)) return; spawn(\'ls\', [d], { shell: true }); }', filename: TS },
    { code: 'function run(d: string) { if (!/^[a-z]+$/.test(d)) return; execFile(\'git\', [\'log\', \'--\', d], { shell: true }, cb); }', filename: TS },
    // #316: a wrapped constant that is a plain word.
    { code: checked('exec(`ls ${String("-la")} ${t}`);'), filename: TS },
    { code: checked('const P = String("git"); exec(`${P} log ${t}`);'), filename: TS },
    { code: checked('exec(`ls ${`-l ${t}` as string}`);'), filename: TS },
    // #317: a parameter that is an argument, not the program.
    { code: checked('exec(`ls $HOME/${t}`);'), filename: TS },
    { code: checked('exec(`echo $PATH ${t}`);'), filename: TS },
    // #318: a path segment regex with `/` between words but no `.`, or `.` but no `/`.
    { code: 'function run(x: string) { if (!/^[a-z]+(\\/[a-z]+)*$/.test(x)) return; exec(`rm -rf /srv/${x}`); }', filename: TS },
    { code: 'function run(x: string) { if (!/^[a-z]+\\.txt$/.test(x)) return; exec(`rm -f /srv/${x}`); }', filename: TS },
    { code: 'function run(x: string) { if (!/^[a-z]+$/.test(x)) return; exec(`rm -rf /srv/"${x}"`); }', filename: TS },
    // #319: an escaped backslash leaves `>&` a redirect.
    { code: checked('exec(`echo \\\\\\\\>&${t}`);'), filename: TS },
    // #321: an allowlist of plain words.
    { code: checked('if (![\'ls\', \'date\'].includes(p)) return; exec(`${p} ${t}`);', 't: string, p: string'), filename: TS },
    { code: checked('if (![\'git\', \'hg\'].includes(p)) return; exec(`/usr/bin/${p} log ${t}`);', 't: string, p: string'), filename: TS },
    { code: checked('if (![\'--json\', \'--yaml\'].includes(f)) return; exec(`tool ${f} ${t}`);', 't: string, f: string'), filename: TS },
    { code: checked('exec(`git -C ${t} checkout ${process.env.BRANCH}`);'), filename: TS, options: [{ trustEnvironment: true }] },
  ],
  invalid: [
    // #313: cmd.exe expands `%VAR%` in a value the regex lets through.
    { code: 'function run(x: string) { if (!/^[\\w%]+$/.test(x)) return; exec(`echo ${x}`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z%]+$/.test(x)) return; exec(`tool --name=${x}`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z%]+$/.test(x)) return; exec(`cat /srv/${x}`); }', filename: TS, errors: error },
    { code: 'const SAFE = /^[a-zA-Z0-9_.%][a-zA-Z0-9_.%\\-]*$/; function run(x: string) { if (!SAFE.test(x)) return; execSync(\'echo \' + x); }', filename: TS, errors: error },
    // #314: a leading `+` is an option to some tools (`dig +short`, `sort +1`).
    { code: 'function run(name: string) { if (!/^[\\w.+]+$/.test(name)) return; exec(`dig ${name} example.com`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[+a-z0-9]+$/.test(x)) return; exec(`sort ${x} file`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^\\+?[a-z]+$/.test(x)) return; exec(`set ${x}`); }', filename: TS, errors: error },
    // #315: with a shell, the args array is joined into the command string.
    { code: 'spawn(\'ls\', [req.query.dir], { shell: true });', filename: TS, errors: error },
    { code: 'execFile(\'git\', [\'log\', branch], { shell: true }, cb);', filename: TS, errors: error },
    { code: 'spawnSync(\'ls\', [`${dir}/x`], { shell: process.platform === \'win32\' });', filename: TS, errors: error },
    { code: 'spawn(\'ls\', args, { shell: true });', filename: TS, errors: error },
    { code: 'spawn(\'ls\', [...extra], { shell: true });', filename: TS, errors: error },
    { code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; spawn(\'sudo\', [t], { shell: true }); }', filename: TS, errors: error },
    { code: 'function run(t: string) { if (!/^[a-z]+$/.test(t)) return; spawn(\'ls\', [\';\', t], { shell: true }); }', filename: TS, errors: error },
    // #316: a separator or wrapper written as a wrapped or deep constant.
    { code: checked('exec(`ls ${String(";")} ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`ls ${";" as string} ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`ls ${";" satisfies string} ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`${"sudo" as string} ${t}`);'), filename: TS, errors: error },
    { code: checked('const P = String("sudo"); exec(`${P} ${t}`);'), filename: TS, errors: error },
    { code: 'const A0 = \'sudo\'; const A1 = A0; const A2 = A1; const A3 = A2; const A4 = A3; const A5 = A4; const A6 = A5; const A7 = A6; const A8 = A7; function run(t: string) { if (!/^[a-z][a-z0-9-]*$/.test(t)) return; exec(`${A8} ${t}`); }', filename: TS, errors: error },
    // #317: a shell parameter as the program name can be any program.
    { code: checked('exec(`$SHELL -c ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`"$SHELL" -c "${t}"`);'), filename: TS, errors: error },
    { code: checked('exec(`W=sudo; $W ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`\\${SUDO:-sudo} ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`$\'env\' ${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`$\'\\\\x65nv\' ${t}`);'), filename: TS, errors: error },
    // #318: a path segment that holds `/` and `.`, or sits in quotes or after another value.
    { code: 'function run(x: string) { if (!/^[a-z./]+[a-z]$/.test(x)) return; exec(`rm -rf /srv/${x}`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z]+(\\/\\.\\.)?$/.test(x)) return; exec(`rm -rf /srv/${x}`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z.]+$/.test(x)) return; exec(`rm -rf /srv/"${x}"`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z.]+$/.test(x)) return; exec(`rm -rf \'/srv/\'${x}`); }', filename: TS, errors: error },
    { code: 'function run(a: string, b: string) { if (!/^[a-z]+\\/?$/.test(a)) return; if (!/^[a-z.]+$/.test(b)) return; exec(`rm -rf /srv/${a}${b}`); }', filename: TS, errors: error },
    { code: 'function run(x: string) { if (!/^[a-z/]+$/.test(x)) return; exec(`rm -rf /srv/${x}`); }', filename: TS, errors: error },
    // #319: an escaped `>` before `&` leaves `&` a separator.
    { code: checked('exec(`echo \\\\>&${t}`);'), filename: TS, errors: error },
    { code: checked('exec(`echo \\\\\\\\\\\\>&${t}`);'), filename: TS, errors: error },
    // #320: bash subscript and quoted assignments before the program.
    { code: checked('execSync(`A[ 0 ]=x ${t}`);'), filename: TS, errors: error },
    { code: checked('execSync(`A["x y"]=1 ${t}`);'), filename: TS, errors: error },
    { code: checked('execSync(`A[a[0]]=x ${t}`);'), filename: TS, errors: error },
    { code: checked('execSync(`A="x y" ${t}`);'), filename: TS, errors: error },
    { code: checked('execSync(`A=\'x y\' B=1 ${t}`);'), filename: TS, errors: error },
    // #321: an allowlisted value read as the shell text it holds.
    { code: checked('if (e !== \'=\') return; execSync(`A${e}1 ${t}`);', 't: string, e: string'), filename: TS, errors: error },
    { code: checked('if (![\'A=1\'].includes(kv)) return; execSync(`${kv} ${t}`);', 't: string, kv: string'), filename: TS, errors: error },
    { code: checked('if (![\'sudo\', \'ls\'].includes(p)) return; exec(`${p} ${t}`);', 't: string, p: string'), filename: TS, errors: error },
    { code: checked('if (!new Set([\'env\']).has(p)) return; exec(`${p} ${t}`);', 't: string, p: string'), filename: TS, errors: error },
    { code: checked('if (![\';\', \'&&\'].includes(s)) return; exec(`ls ${s} ${t}`);', 't: string, s: string'), filename: TS, errors: error },
    { code: checked('if (p !== \'sudo ls\') return; exec(`${p} ${t}`);', 't: string, p: string'), filename: TS, errors: error },
    { code: 'function run(base: string, x: string) { if (![\'/srv/\', \'/tmp/\'].includes(base)) return; if (!/^[a-z.]+$/.test(x)) return; exec(`rm -rf ${base}${x}`); }', filename: TS, errors: error },
    { code: checked('exec(`${process.env.TOOL} ${t}`);'), filename: TS, options: [{ trustEnvironment: true }], errors: error },
    { code: checked('exec(`git -C ${process.env.REPO_DIR} log ${t}`);'), filename: TS, options: [{ trustEnvironment: true }], errors: error },
  ],
});

/** A function whose `x` and `t` passed shell-inert regex checks before `body` runs. */
const checkedTwo = (body: string): string =>
  `function run(x: string, t: string) { if (!/^[a-z]+$/.test(x)) return; if (!/^[a-z][a-z0-9-]*$/.test(t)) return; ${body} }`;
/** A joi schema `S` checked on `x`, then `value` used in `body` with a checked `t`. */
const joiChecked = (schema: string, body: string): string =>
  `const Joi = require('joi'); const S = ${schema}; function run(x: string, t: string) { if (!/^[a-z][a-z0-9-]*$/.test(t)) return; const { error, value } = S.validate(x); if (error) return; ${body} }`;

// #360: case-changed schema literals, `sh -c` without a shell option and
// value-built find actions or runner subcommands.
ruleTester.run('no-shell-interpolation follow-ups', noShellInterpolationRule, {
  valid: [
    // A case change that leaves a plain program name.
    { code: joiChecked("Joi.string().valid('LS').lowercase()", 'exec(`${value} ${t}`);'), filename: TS },
    { code: joiChecked("Joi.string().valid('ls')", 'exec(`${value} ${t}`);'), filename: TS },
    // `sh -c` with a static or proven command, or a script file.
    { code: "spawn('sh', ['-c', 'ls -la']);", filename: TS },
    { code: checked("spawn('sh', ['-c', `ls ${t}`]);"), filename: TS },
    { code: "spawn('sh', ['./deploy.sh', target]);", filename: TS },
    { code: "spawn('bash', ['-lc', 'echo \"$1\"', 'name', target]);", filename: TS },
    { code: "spawn('node', ['-e', `console.log(${x})`]);", filename: TS },
    // A command held whole in a binding is not built here, as with `exec(cmd)`.
    { code: "spawn('sh', ['-c', cmd]);", filename: TS },
    // A value-built word that cannot be a find action or a runner subcommand.
    { code: checkedTwo('exec(`find . -name ${x} ${t}`);'), filename: TS },
    { code: checkedTwo('exec(`git log -${x} ${t}`);'), filename: TS },
    { code: checkedTwo('exec(`npm install ${x} ${t}`);'), filename: TS },
  ],
  invalid: [
    // A literal that becomes a wrapper once its case changes.
    { code: joiChecked("Joi.string().valid('SUDO').lowercase()", 'exec(`${value} ${t}`);'), filename: TS, errors: error },
    { code: joiChecked("Joi.string().lowercase().valid('Sudo')", 'exec(`${value} ${t}`);'), filename: TS, errors: error },
    { code: joiChecked("Joi.string().valid('ENV').trim().lowercase()", 'exec(`${value} ${t}`);'), filename: TS, errors: error },
    // `sh -c` and friends with no shell option.
    { code: "function dig(d: string) { spawn('sh', ['-c', `dig +short ${d} A`]); }", filename: TS, errors: error },
    { code: "function dig(d: string) { const cmd = `dig +short ${d} A`; spawn('sh', ['-c', cmd]); }", filename: TS, errors: error },
    { code: "function log(b: string) { execFile('/bin/bash', ['-lc', 'git log ' + b], cb); }", filename: TS, errors: error },
    { code: "function pack(f: string) { spawnSync('bash', ['-e', '-c', `tar czf ${f}.tgz src`]); }", filename: TS, errors: error },
    { code: "function pipe(x: string) { spawn('sh', ['-o', 'pipefail', '-c', `grep ${x} log | wc -l`]); }", filename: TS, errors: error },
    { code: "function pipe(x: string) { spawn('sh', ['-c', `grep ${x} log`], { shell: false }); }", filename: TS, errors: error },
    { code: "function show(f: string) { spawn('cmd.exe', ['/d', '/s', '/c', `type ${f}`]); }", filename: TS, errors: error },
    { code: "function show(f: string) { spawn('cmd', ['/c', 'type', f]); }", filename: TS, errors: error },
    { code: checked("spawn('sh', ['-c', `sudo ${t}`]);"), filename: TS, errors: error },
    {
      code: "import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; const run = promisify(execFile); async function f(y: string) { await run('sh', ['-c', `ls ${y}`]); }",
      filename: TS,
      errors: error,
    },
    // A proven value that spells a find action or a runner subcommand.
    { code: checkedTwo('exec(`find . -${x} ${t}`);'), filename: TS, errors: error },
    { code: checkedTwo('exec(`find . -name a -e${x} ${t}`);'), filename: TS, errors: error },
    { code: checkedTwo('exec(`npm ${x} ${t}`);'), filename: TS, errors: error },
    { code: checkedTwo('exec(`pnpm ${x} ${t}`);'), filename: TS, errors: error },
    { code: checkedTwo('exec(`npm --prefix /srv ${x} ${t}`);'), filename: TS, errors: error },
  ],
});

/** A function whose `d` is unchecked and whose `cmd` is built from it before `body`. */
const builtCmd = (body: string): string =>
  `function run(d: string) { const cmd = \`dig +short \${d} A\`; ${body} } function forward<T>(value: T): T { return value; }`;
/** The same with `d` checked against a shell-inert regex first. */
const checkedCmd = (body: string): string =>
  `function run(d: string) { if (!/^[a-z.]+$/.test(d)) return; const cmd = \`dig +short \${d} A\`; ${body} } function forward<T>(value: T): T { return value; }`;

// The `sh -c` command moved through a holder, an element, a local identity
// function, destructuring or a callback; shells started through `env`, long
// valued options and args arrays held in a binding.
ruleTester.run('no-shell-interpolation: sh -c command flows', noShellInterpolationRule, {
  valid: [
    // A proven command stays proven along an exact move.
    ...[
      "const holder = { value: cmd }; spawn('sh', ['-c', holder.value]);",
      "const items = [cmd]; spawn('sh', ['-c', items[0]]);",
      "const { value: picked } = { value: cmd }; spawn('sh', ['-c', picked]);",
      "spawn('sh', ['-c', forward(cmd)]);",
      "[cmd].forEach((relay) => { spawn('sh', ['-c', relay]); });",
      "const args = ['-c', cmd]; spawn('sh', args);",
      "spawn('/usr/bin/env', ['sh', '-c', cmd]);",
    ].map((body) => ({ code: checkedCmd(body), filename: TS })),
    // Static commands and programs that are not a shell.
    { code: "const holder = { value: 'ls -la' }; spawn('sh', ['-c', holder.value]);", filename: TS },
    { code: "const args = ['-c', 'dig +short example.com A']; spawn('sh', args);", filename: TS },
    { code: "const args = ['./run.sh', target]; spawn('sh', args);", filename: TS },
    { code: builtCmd("spawn('env', ['node', '-e', cmd]);"), filename: TS },
    { code: builtCmd("spawn('env', ['-S', 'sh -c', cmd]);"), filename: TS },
  ],
  invalid: [
    ...[
      "const holder = { value: cmd }; spawn('sh', ['-c', holder.value]);",
      "const items = [cmd]; execFile('bash', ['-lc', items[0]]);",
      "const { value: picked } = { value: cmd }; spawn('sh', ['-c', picked]);",
      "spawn('sh', ['-c', forward(cmd)]);",
      "[cmd].forEach((relay) => { spawn('sh', ['-c', relay]); });",
      "const args = ['-c', cmd]; spawn('sh', args);",
      "const args = ['-c', `dig ${d}`] as const; spawnSync('bash', args);",
      "spawn('/usr/bin/env', ['sh', '-c', cmd]);",
      "spawn('env', ['-i', 'PATH=/bin', 'bash', '-lc', cmd]);",
      "spawn('env', ['-u', 'HOME', '--', 'sh', '-c', cmd]);",
      "spawn('bash', ['--rcfile', '/etc/app.rc', '-c', cmd]);",
      "execFile('bash', ['--init-file', '/etc/app.rc', '-ic', cmd]);",
    ].map((body) => ({ code: builtCmd(body), filename: TS, errors: error })),
  ],
});

// An args binding changed in place, aliased or handed to a call before the
// runner reads it: the command is whatever was put there.
ruleTester.run('no-shell-interpolation: sh -c args changed in place', noShellInterpolationRule, {
  valid: [
    ...[
      "const args = ['-c', 'ls']; spawn('sh', args);",
      "const args = ['-c', 'ls']; spawn('sh', args); execFile('sh', args);",
      "let args; args = ['-c', 'ls']; spawn('sh', args);",
      "let args = ['-c', 'ls']; if (d) args = ['-c', 'pwd']; spawn('sh', args);",
      "const holder = { args: ['-c', 'ls'] }; spawn('sh', holder.args);",
      "const args = ['x']; args.push(d); spawn('node', args);",
    ].map((body) => ({ code: `function run(d: string) { ${body} }`, filename: TS })),
  ],
  invalid: [
    ...[
      "const args = ['-c', 'ls']; args[1] = `dig ${d}`; spawn('sh', args);",
      "const args = ['-c']; args.push(`dig ${d}`); spawn('sh', args);",
      "const args = ['-c', 'ls']; args.splice(1, 1, `dig ${d}`); spawn('sh', args);",
      "const args = ['-c', 'ls']; const a = args; a[1] = `dig ${d}`; spawn('sh', args);",
      "const args = ['-c', 'ls']; fill(args, d); spawn('sh', args);",
      "const args = ['-c', 'ls']; Object.assign(args, { 1: d }); execFile('bash', args);",
      "let args = ['-c', 'ls']; if (d) args = ['-c', `dig ${d}`]; spawn('sh', args);",
      "const holder = { args: ['-c', 'ls'] }; holder.args[1] = d; spawn('sh', holder.args);",
    ].map((body) => ({ code: `function run(d: string) { ${body} }`, filename: TS, errors: error })),
  ],
});

// Uses of an args binding that cannot change the array keep its fixed
// command known; fixed text added in place is read with it.
ruleTester.run('no-shell-interpolation: sh -c args read but not changed', noShellInterpolationRule, {
  valid: [
    ...[
      "const args = ['-c', 'ls -la']; if (args.length) spawn('sh', args);",
      "const args = ['-c', 'ls -la']; console.log(args); spawn('sh', args);",
      "const args = ['-c']; args.push('ls -la'); spawn('sh', args);",
      "const args = ['-c', 'ls -la']; log(args[1], args.at(0), `${args}`, 'run ' + args, String(args)); spawn('sh', args);",
      "const args = ['-c', 'ls -la']; if (args.includes('-c') && args.indexOf('x') < 0) log(args.join(' ')); spawn('sh', args);",
      "const args = ['-c', 'ls -la']; log(JSON.stringify(args), JSON.stringify(args, null, 2)); spawn('sh', args);",
      "const args = ['-c', 'ls -la']; const copy = [...args, d]; copy.push(d); spawn('sh', args);",
      "const args = ['ls -la']; args.unshift('-c'); spawn('sh', args);",
      "const args = ['-c', 'ls']; args.splice(1, 1, 'pwd'); spawn('sh', args);",
      // Fixed text pushed after a proven command.
      "if (!/^[a-z.]+$/.test(d)) return; const args = ['-c', `dig ${d}`]; args.push('extra'); spawn('sh', args);",
    ].map((body) => ({ code: `function run(d: string) { ${body} } function log(...v: unknown[]) {}`, filename: TS })),
  ],
  invalid: [
    ...[
      // A runtime value added, or fixed text that moves a runtime element into the command.
      "const args = ['-c', 'ls']; args.push(d); spawn('sh', args);",
      "const args = ['-c']; args.push('ls', `dig ${d}`); spawn('sh', args);",
      "const args = ['-c']; args.push(...more); spawn('sh', args);",
      "const args = [`dig ${d}`]; args.unshift('-c'); spawn('sh', args);",
      "const args = ['-c', 'ls', `dig ${d}`]; args.splice(1, 1); spawn('sh', args);",
      // Any other use may change the array.
      "const args = ['-c', 'ls']; args.sort(); spawn('sh', args);",
      "const args = ['-c', 'ls']; args.length = 0; spawn('sh', args);",
      "const args = ['-c', 'ls']; args[1] += d; spawn('sh', args);",
      "const args = ['-c', 'ls']; delete args[1]; spawn('sh', args);",
      "const args = ['-c', 'ls']; [, args[1]] = ['', d]; spawn('sh', args);",
      "const args = ['-c', 'ls']; args[d](d); spawn('sh', args);",
      "const args = ['-c', 'ls']; JSON.stringify(args, (k, v) => v); spawn('sh', args);",
      "const console = { log: fill }; const args = ['-c', 'ls']; console.log(args, d); spawn('sh', args);",
      "const args = ['-c', 'ls']; const b = args || []; b.push(d); spawn('sh', args);",
      "const args = ['-c', 'ls']; log(...args); fill(args, d); spawn('sh', args);",
    ].map((body) => ({
      code: `function run(d: string, more: string[]) { ${body} } function log(...v: unknown[]) {}`,
      filename: TS,
      errors: error,
    })),
  ],
});
