# `noctcore-electron/no-shell-outside-allowlist`

> Electron's `shell` is used only in the module that checks what it hands to the operating system.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`shell.openExternal(url)` passes a URL to the operating system, which runs whatever is registered
for its scheme: `file:`, `smb:` or a custom protocol can start a program. `shell.openPath(path)`
opens a file with its default application. A URL from a link in rendered content, a message from
the renderer or a remote config must pass a scheme and path check first, and that check is only
reliable if it lives in one place. Every other file calls that module:

```ts bad filename=src/main/window.ts options={"allowIn":["**/src/main/external-links.ts"]}
import { shell } from 'electron';

win.webContents.setWindowOpenHandler(({ url }) => {
  void shell.openExternal(url);
  return { action: 'deny' };
});
```

```ts good filename=src/main/window.ts options={"allowIn":["**/src/main/external-links.ts"]}
import { openExternalSafely } from './external-links';

win.webContents.setWindowOpenHandler(({ url }) => {
  void openExternalSafely(url);
  return { action: 'deny' };
});
```

## What it flags

Outside the files in `allowIn`, every way of reaching `shell` from `electron`:

- `import { shell } from 'electron'`, aliased or not;
- `electron.shell` through a default or namespace import, `const electron = require('electron')`
  or `require('electron').shell`;
- `const { shell } = electron` and `const { shell } = require('electron')`.

```ts bad filename=src/main/menu.ts options={"allowIn":["**/src/main/external-links.ts"]}
import electron from 'electron';

export const helpItem = { label: 'Docs', click: () => electron.shell.openExternal(DOCS_URL) };
```

## What it does not flag

- Any use inside a file matched by `allowIn`.
- A `shell` that is not Electron's: `shelljs`, a config field, a local variable.

```ts good filename=src/main/external-links.ts options={"allowIn":["**/src/main/external-links.ts"]} relocation
import { shell } from 'electron';

export async function openExternalSafely(url: string): Promise<void> {
  if (!/^https?:/u.test(url)) return;
  await shell.openExternal(url);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files that may use `shell`, matched against the absolute path and the path relative to the working directory or workspace root, so `src/main/security.ts` and `**/main/security.ts` both work. |

```js
'noctcore-electron/no-shell-outside-allowlist': ['error', { allowIn: ['**/src/main/external-links.ts'] }]
```

Without `allowIn`, every use is reported, the checked module included.

## When not to use it

An app that never calls `shell` gains nothing; one that has not yet written the checked module
should write it first and then turn this on.
