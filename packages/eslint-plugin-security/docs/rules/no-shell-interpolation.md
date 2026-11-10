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
expressions, or a `+` of literals only (`'ls ' + '-la'`).

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `extraCallees` | `string[]` | `[]` | Extra callee names to treat as always-shell command runners (checked like `exec`). |

```js
'noctcore-security/no-shell-interpolation': ['error', { extraCallees: ['runShell', 'sh'] }]
```

## When not to use it

If a call site is provably safe (a hard-coded allowlist of commands, no user input in the string),
refactor to `execFile` anyway — it is clearer — or disable the rule for that line.
