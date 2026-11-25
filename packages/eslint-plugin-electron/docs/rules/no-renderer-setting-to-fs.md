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
`path.normalize`. Every tainted operand is followed: a containment check on one setting does not
cover a second setting joined or concatenated onto it.

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

A `{ function, returns: 'value' }` source is a getter whose return value is the setting itself;
`keys` match its first argument:

```ts bad filename=src/main/export.ts options={"sources":[{"function":"getSetting","returns":"value"}]}
import fs from 'node:fs';

export function readLastExport(): Buffer {
  return fs.readFileSync(getSetting('lastExportFile'));
}
```

`path.basename` keeps a value inside the base only for a sink that acts on a file. For a sink that
removes, lists, copies, moves, changes the mode of, links to, trashes or opens a directory (`rm`,
`rmdir`, `readdir`, `opendir`, `cp`, `rename`, `chmod`, `symlink`, `shell.trashItem`,
`shell.openPath`, in every form) it is not containment: `path.basename('..')` is
`'..'`, and `''` or `'.'` joined under the base is the base itself, so the setting can still name
the parent folder or the whole base:

```ts bad filename=src/main/cache.ts options={"sources":[{"object":"store","method":"get"}]}
import fs from 'node:fs';
import path from 'node:path';

export function clearProfileCache(): void {
  fs.rmSync(path.join(CACHE_DIR, path.basename(store.get('profile'))), { recursive: true });
}
```

A test of the raw setting (`file.startsWith('.')`) is not a containment check, and neither is a
check that comes after the call.

## What it does not flag

- A path built from the setting and tested for containment in the same function, when the result of
  the test decides whether the sink runs: an `if` before it that returns or throws when the path is
  outside, or an `if`, `?:`, `&&` or `||` around it. The tests are the ones
  `security/require-path-containment` accepts, on the `path.join` / `path.resolve` result:
  `full.startsWith(base + path.sep)` (the base must end in a separator, or `/srv/app-evil` passes
  a test for `/srv/app`), or a `path.relative(base, full)` result refused both when it climbs
  (`rel.startsWith('..')`) and when it is absolute (`path.isAbsolute(rel)`), every refusal on the
  same result (one binding, or inline `path.relative(...)` calls with the same arguments). A test whose result is
  ignored, one that guards another statement, one in a nested function, and one against `'/'`,
  `path.sep` or `process.cwd()` (every path is under those) do not count.
- A call to a function in `sanitizers` that takes a binding the setting went through, before the
  sink (`assertInside(base, file)`).
- `path.basename(value)` reaching a sink that acts on a file (`readFile`, `writeFile`, `stat`,
  `unlink`, ...): it strips the directories, so what is left names an entry of the directory you
  join it to. `..`, `.` or an empty name there points at a directory, which a file read or write
  refuses. Directory sinks are flagged, as shown above.
- An allowlist check, when you add `includes` to `sanitizers`: `ALLOWED.includes(name)` before the
  sink, with `name` a binding the setting went through.
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
| `sources` | array of `{ object, method, keys? }` or `{ function, returns?, keys? }` | `[]` | Calls whose result the renderer can write. `{ object: 'store', method: 'get' }` matches `store.get(...)`, `this.store.get(...)` and `store['get'](...)`; `{ function: 'loadSettings' }` matches `loadSettings()` and `this.loadSettings()` and treats every property of the result as a setting. Empty, the rule reports nothing. |
| `sources[].returns` | `'object'` or `'value'` | `'object'` | For a `{ function }` source: `'object'` is a loader that returns the settings object, `'value'` a getter (`getSetting('key')`) that returns one setting. |
| `sources[].keys` | `string[]` (globs) | unset | Only these keys count: the first argument of a store call or getter, the property read off a loader's object. `*` matches any run of characters except `/`, so `theme.*` matches every key under `theme`. |
| `sanitizers` | `string[]` | `[]` | Functions that check a path stays inside its base and throw or return false otherwise. A call to one that takes a binding of the chain, before the sink, ends it. Add `includes` to accept an allowlist check such as `ALLOWED.includes(name)`. |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-electron/no-renderer-setting-to-fs': ['error', {
  sources: [
    { object: 'store', method: 'get', keys: ['customAvatarPath', 'theme.*', 'exportDir'] },
    { function: 'loadSettings' },
    { function: 'getSetting', returns: 'value', keys: ['paths.*'] },
  ],
  sanitizers: ['assertInside', 'includes'],
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
