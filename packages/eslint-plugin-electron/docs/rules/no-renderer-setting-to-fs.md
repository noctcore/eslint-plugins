# `noctcore-electron/no-renderer-setting-to-fs`

> A path the renderer can write into the settings store does not reach `fs` or `shell.openPath` unchecked.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Settings that the renderer can change through IPC are renderer input, even when the main process
reads them back much later and from another file. A custom avatar, a background image or an export
folder kept as a path in such a setting, and later handed to `fs.readFile` or `shell.openPath`
without a containment check, lets any frame that can reach the settings channel read, overwrite or
open any file the app can:

```ts bad filename=src/main/avatar.ts options={"sources":[{"object":"store","method":"get"}]}
import fs from 'node:fs/promises';
import { ipcMain } from 'electron';

ipcMain.handle('avatar:load', async () => {
  const file = store.get('customAvatarPath');
  return fs.readFile(file);
});
```

Resolve the path under the directory it belongs to and check that the result is still inside it:

```ts good filename=src/main/avatar.ts options={"sources":[{"object":"store","method":"get"}]}
import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcMain } from 'electron';

ipcMain.handle('avatar:load', async () => {
  const file = store.get('customAvatarPath');
  const full = path.resolve(AVATAR_DIR, file);
  if (!full.startsWith(AVATAR_DIR + path.sep)) throw new Error('Avatar outside its folder');
  return fs.readFile(full);
});
```

`security/require-path-containment` does not see this: its source is a request object passed
straight into `path.join`, and here the value comes out of a store call.

## What it flags

In one function, a value returned by a call listed in `sources` that reaches:

- the path argument of an `fs` function that reads, writes, lists or deletes (`readFile`,
  `writeFile`, `createReadStream`, `readdir`, `stat`, `unlink`, `rm` and the rest, in callback,
  sync and promise forms), both paths of `copyFile`, `cp`, `rename`, `link` and `symlink`. `fs`,
  `node:fs`, `fs/promises` and Electron's `original-fs` count, imported or required under any name,
  `fs.promises` and named imports included;
- `shell.openPath`, `shell.showItemInFolder` and `shell.trashItem` from `electron`.

The value is followed through `const` bindings, destructuring, member reads, template literals,
`+`, `??` and `||`, `await`, `String(...)`, `.trim()`, and `path.join`, `path.resolve` and
`path.normalize`:

```ts bad filename=src/main/theme.ts options={"sources":[{"object":"store","method":"get","keys":["theme.*"]}]}
import fs from 'node:fs';
import path from 'node:path';

export function loadBackground(): Buffer {
  const image = store.get('theme.backgroundImage');
  return fs.readFileSync(path.join(THEMES_DIR, `${image}.png`));
}
```

A `{ function }` source is a loader that returns the whole settings object; every property read
off it is a setting:

```ts bad filename=src/main/export.ts options={"sources":[{"function":"loadSettings"}]}
import { shell } from 'electron';

export function revealExport(): void {
  const { exportDir } = loadSettings();
  void shell.openPath(exportDir);
}
```

A test of the raw setting (`file.startsWith('.')`) is not a containment check, and neither is a
check that comes after the call.

## What it does not flag

- A path built from the setting and tested for containment before the sink, in the same function:
  `full.startsWith(base)` or `path.relative(base, full)` on the `path.join` / `path.resolve` result,
  the same shapes `security/require-path-containment` accepts. Like that rule, it checks that the
  test exists, not what the code does with its result.
- A call to a function in `sanitizers` that takes a binding the setting went through, before the
  sink (`assertInside(base, file)`).
- `path.basename(value)`: it strips the directories, so what is left can only name a file in the
  directory you join it to.
- Any other call between the source and the sink. A helper that returns a checked path
  (`resolveInside(base, file)`) is already silent without being listed; so is
  `decodeURIComponent(file)` or `file.replace(...)`, which is a known blind spot.
- A `let`, a function parameter, a binding declared in another function or at module level, and an
  object property written after the object was made. The rule follows one function only, so a
  value read in one function and passed to another is not followed.
- A store, loader or key that is not configured, and with `keys` set, a key the rule cannot read
  as a string (`store.get(key)`).

```ts good filename=src/main/theme.ts options={"sources":[{"object":"store","method":"get","keys":["theme.*"]}]}
import fs from 'node:fs';
import path from 'node:path';

export function loadBackground(): Buffer {
  const image = path.basename(store.get('theme.backgroundImage'));
  return fs.readFileSync(path.join(THEMES_DIR, `${image}.png`));
}
```

```ts good filename=src/main/export.ts options={"sources":[{"function":"loadSettings"}],"sanitizers":["assertInside"]} reconfigured
import { shell } from 'electron';

export function revealExport(): void {
  const { exportDir } = loadSettings();
  assertInside(app.getPath('documents'), exportDir);
  void shell.openPath(exportDir);
}
```

The rule does not know which process a file runs in. Scope it to main-process files with your
flat config's `files`, as the other rules in this plugin are.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sources` | array of `{ object, method, keys? }` or `{ function, keys? }` | `[]` | Calls whose result the renderer can write. `{ object: 'store', method: 'get' }` matches `store.get(...)` and `this.store.get(...)`; `{ function: 'loadSettings' }` matches `loadSettings()` and `this.loadSettings()` and treats every property of the result as a setting. Empty, the rule reports nothing. |
| `sources[].keys` | `string[]` (globs) | unset | Only these keys count: the first argument of a store call, the property read off a loader's object. `*` matches any run of characters except `/`, so `theme.*` matches every key under `theme`. |
| `sanitizers` | `string[]` | `[]` | Functions that check a path stays inside its base and throw or return false otherwise. A call to one that takes a binding of the chain, before the sink, ends it. |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-electron/no-renderer-setting-to-fs': ['error', {
  sources: [
    { object: 'store', method: 'get', keys: ['customAvatarPath', 'theme.*', 'exportDir'] },
    { function: 'loadSettings' },
  ],
  sanitizers: ['assertInside'],
}]
```

List only the stores and keys the renderer can write. A key the main process alone sets is not
renderer input, and listing it reports paths that are safe.

## When not to use it

An app whose renderer cannot write settings, or whose settings hold no paths, gains nothing. An app
that already routes every settings path through one checked resolver can keep it off, or list the
resolver's callers in `allowIn`.

## Related

- [`security/require-path-containment`](https://noctcore.github.io/eslint-plugins/rules/security/require-path-containment/):
  the same containment check for request input in a server.
- [`ipc-handler-validates-sender`](https://noctcore.github.io/eslint-plugins/rules/electron/ipc-handler-validates-sender/):
  checks who may send on the settings channel in the first place.
