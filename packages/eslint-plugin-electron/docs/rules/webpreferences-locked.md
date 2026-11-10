# `noctcore-electron/webpreferences-locked`

> No Electron window turns off a renderer isolation flag.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Electron's defaults already follow its security checklist: no Node in the renderer, context
isolation on, the renderer sandboxed, web security on, no `<webview>`. Each flag can be flipped in
`webPreferences`, usually during a debugging session or to make one library work, and the flipped
value then ships. A renderer with `nodeIntegration: true` that ever shows remote content (an ad, a
link preview, a page navigated to by mistake) hands that content `require('child_process')`.

```ts bad
const win = new BrowserWindow({
  width: 1200,
  webPreferences: { preload: PRELOAD, nodeIntegration: true, contextIsolation: false },
});
```

```ts good
const win = new BrowserWindow({
  width: 1200,
  webPreferences: { preload: PRELOAD, nodeIntegration: false, contextIsolation: true },
});
```

Expose what the renderer needs through the preload with `contextBridge`, not by giving it Node.

## What it flags

A property with a literal value:

- `nodeIntegration`, `nodeIntegrationInSubFrames`, `nodeIntegrationInWorker`, `webviewTag`,
  `allowRunningInsecureContent` or `experimentalFeatures` set to `true`;
- `contextIsolation` or `webSecurity` set to `false`;
- `sandbox` set to `false` inside a `webPreferences` object, or in an object that also names
  another Electron-only preference.

The Electron-only names are reported in any object literal, so a preferences object built before
the window is caught too:

```ts bad
const sharedPreferences = { contextIsolation: true, sandbox: false };
new BrowserWindow({ webPreferences: sharedPreferences });
```

## What it does not flag

- A flag set from a variable or a spread: the check is literal-only, so keep these flags literal
  where the window is made.
- `sandbox: false` in an object that is not web preferences, such as a payment SDK's sandbox mode.
- Command-line switches such as `app.commandLine.appendSwitch('no-sandbox')`.

```ts good
const stripe = new Stripe(key, { sandbox: false });
new BrowserWindow({ webPreferences: { preload: PRELOAD } });
```

## When not to use it

Only for an app that never loads anything but its own bundled code and has decided, on purpose,
to give the renderer Node. Even then, the flags are worth stating once and suppressing with a
comment that says why.
