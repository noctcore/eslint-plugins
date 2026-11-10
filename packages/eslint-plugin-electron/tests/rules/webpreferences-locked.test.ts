import { ruleTester } from '@noctcore/eslint-test-utils';

import { webpreferencesLockedRule } from '../../src/rules/webpreferences-locked';

ruleTester.run('webpreferences-locked', webpreferencesLockedRule, {
  valid: [
    // The checklist settings, written out.
    {
      code: `new BrowserWindow({ webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });`,
    },
    // The defaults, left implicit.
    { code: `new BrowserWindow({ width: 800, webPreferences: { preload } });` },
    // Set from a variable: literal-only by design.
    { code: `new BrowserWindow({ webPreferences: { sandbox: isTest } });` },
    // `sandbox` outside a web-preferences object is someone else's setting.
    { code: `const stripe = new Stripe(key, { sandbox: false });` },
    { code: `const iframeConfig = { sandbox: false, src };` },
    // A computed key is not followed.
    { code: `const prefs = { [flag]: true };` },
  ],
  invalid: [
    {
      code: `new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false } });`,
      errors: [
        { messageId: 'mustStayFalse', data: { name: 'nodeIntegration' } },
        { messageId: 'mustStayTrue', data: { name: 'contextIsolation' } },
      ],
    },
    {
      code: `new BrowserWindow({ webPreferences: { sandbox: false } });`,
      errors: [{ messageId: 'mustStayTrue', data: { name: 'sandbox' } }],
    },
    {
      code: `new WebContentsView({ webPreferences: { webSecurity: false, allowRunningInsecureContent: true } });`,
      errors: [{ messageId: 'mustStayTrue' }, { messageId: 'mustStayFalse' }],
    },
    // A preferences object built before the window: the Electron-only names give it away.
    {
      code: `const prefs = { contextIsolation: true, sandbox: false };\nnew BrowserWindow({ webPreferences: prefs });`,
      errors: [{ messageId: 'mustStayTrue', data: { name: 'sandbox' } }],
    },
    {
      code: `const shared = { nodeIntegrationInWorker: true };`,
      errors: [{ messageId: 'mustStayFalse' }],
    },
    {
      code: `win.webContents.on('will-attach-webview', (e, prefs) => Object.assign(prefs, { 'webviewTag': true }));`,
      errors: [{ messageId: 'mustStayFalse' }],
    },
    {
      code: `new BrowserWindow({ webPreferences: { nodeIntegrationInSubFrames: true, experimentalFeatures: true } });`,
      errors: [{ messageId: 'mustStayFalse' }, { messageId: 'mustStayFalse' }],
    },
  ],
});
