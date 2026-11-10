# `noctcore-electron/ipc-handler-validates-sender`

> Every main-process IPC handler checks who sent the message before doing anything else.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

An IPC channel is a direct call from a renderer into code that runs with Node and the operating
system. Any frame in the app can send on it: an iframe, a page navigated to by mistake, remote
content a later feature adds. The Electron security checklist asks for every message's sender
(`event.senderFrame`) to be validated, and the check only counts if it comes first: one placed
after an `await`, a store write or a dialog has already done what it was meant to prevent.

```ts bad
ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
  store.set(key, value);
});
```

```ts good
ipcMain.handle('settings:set', async (event, key: string, value: unknown) => {
  if (!isTrustedSender(event.senderFrame)) throw new Error('Forbidden sender');
  store.set(key, value);
});
```

## What it flags

An inline handler passed to `ipcMain.handle`, `handleOnce`, `on` or `once` that:

- takes no event parameter, so it cannot check the sender;
- has an expression body, so there is no first statement to check in;
- does not check the sender in its first statement. Without `guards`, a first statement that reads
  the event (or a field destructured from it) counts; with `guards`, it must call one of those
  functions with the event.

```ts bad options={"guards":["isSenderFrameAllowed"]}
ipcMain.handle('dialog:open', async (event) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
  return result;
});
```

```ts good
ipcMain.handle('dialog:open', async (event) => {
  if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');
  return dialog.showOpenDialog({ properties: ['openFile'] });
});
```

## What it does not flag

- A handler passed by name (`ipcMain.handle('x', onX)`): it is not followed, so check the sender
  where `onX` is defined.
- `ipcRenderer` listeners and `removeHandler`: only main-process registrations are checked.
- A main-process function that reads a path from renderer-writable settings and hands it to `fs`:
  that needs data-flow tracking this rule does not do.

```ts good
ipcMain.handle('settings:get', handleSettingsGet);
ipcMain.removeHandler('settings:get');
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `guards` | `string[]` | unset | Functions that validate the sender. When set, the first statement must call one with the event. |
| `receivers` | `string[]` | `['ipcMain']` | Identifiers that name the main-process IPC module. |

```js
'noctcore-electron/ipc-handler-validates-sender': ['error', { guards: ['isSenderFrameAllowed'] }]
```

## When not to use it

An app whose windows only ever load its own bundled files, with navigation and new windows blocked,
has no foreign frame to fear today. The check is still the one line that keeps that true when a
feature starts rendering remote content.
