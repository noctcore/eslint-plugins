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
  when an options object passes `shell: true` (or a shell path string).

```ts bad
// shell:true re-parses the interpolated command
spawn(`cmd ${x}`, { shell: true });
```

There is **no autofix**: the safe rewrite changes the call shape (string → program + args array).

## What it does not flag

The array-args, no-shell forms are safe and left alone, even with a dynamic argument (and with an
explicit `shell: false`):

```ts good
// left alone: no shell
spawn('ls', [dir]);
execFile('git', ['log', branch]);
```

`exec` called as a **member on a non-`child_process` object** — notably `regex.exec(...)` — is
excluded so `RegExp.prototype.exec` never false-positives. The `child_process` member form is
recognised via the conventional object names `cp` / `childProcess` / `child_process`, or the bare
imported `exec(...)`.

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
