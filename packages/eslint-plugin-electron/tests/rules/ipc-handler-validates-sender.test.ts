import { ruleTester } from '@noctcore/eslint-test-utils';

import { ipcHandlerValidatesSenderRule } from '../../src/rules/ipc-handler-validates-sender';

const GUARD = [{ guards: ['isSenderFrameAllowed'] }];

ruleTester.run('ipc-handler-validates-sender', ipcHandlerValidatesSenderRule, {
  valid: [
    // The consumer's shapes: the guard first, returning for `on`, throwing for `handle`.
    { code: `ipcMain.on('window:minimize', (event) => {\n  if (!isSenderFrameAllowed(event)) return;\n  mainWindow.minimize();\n});`, options: GUARD },
    {
      code: `ipcMain.handle('window:is-maximized', (event) => {\n  if (!isSenderFrameAllowed(event)) throw new Error('Forbidden sender');\n  return mainWindow.isMaximized();\n});`,
      options: GUARD,
    },
    { code: `ipcMain.handle('app:get-site-url', async (event) => {\n  if (!this.security.isSenderFrameAllowed(event)) throw new Error('Forbidden');\n  return getSiteUrl();\n});`, options: GUARD },
    // Without `guards`, a first statement that reads the event counts.
    { code: `ipcMain.handle('store:get', (event, key) => {\n  assertTrustedSender(event.senderFrame);\n  return store.get(key);\n});` },
    { code: `ipcMain.handle('store:get', function ({ senderFrame }, key) {\n  if (!isTrusted(senderFrame)) throw new Error('Forbidden');\n  return store.get(key);\n});` },
    // A handler passed by name is not followed.
    { code: `ipcMain.handle('store:get', handleStoreGet);` },
    // Removing a handler is not registering one.
    { code: `ipcMain.removeHandler('store:get');` },
    // Not the main-process IPC module.
    { code: `ipcRenderer.on('updater:progress', (_event, p) => setProgress(p));` },
    { code: `emitter.on('data', () => {});` },
  ],
  invalid: [
    {
      code: `ipcMain.handle('store:set', async (_event, key, value) => {\n  store.set(key, value);\n});`,
      errors: [{ messageId: 'notFirst', data: { channel: 'store:set' }, line: 2 }],
    },
    // The check comes after the work.
    {
      code: `ipcMain.handle('dialog:open', async (event) => {\n  const result = await dialog.showOpenDialog({});\n  if (!isSenderFrameAllowed(event)) throw new Error('Forbidden');\n  return result;\n});`,
      options: GUARD,
      errors: [{ messageId: 'notFirst', line: 2 }],
    },
    // With `guards`, reading the event is not enough.
    {
      code: `ipcMain.on('log', (event, line) => {\n  console.log(event.sender.id, line);\n});`,
      options: GUARD,
      errors: [{ messageId: 'notFirst' }],
    },
    {
      code: `ipcMain.handle('app:get-version', () => app.getVersion());`,
      errors: [{ messageId: 'noEventParameter', data: { channel: 'app:get-version' } }],
    },
    {
      code: `ipcMain.handle('app:get-version', (event) => app.getVersion());`,
      errors: [{ messageId: 'noBlockBody' }],
    },
    {
      code: `ipcMain.once(CHANNEL, (event) => {});`,
      errors: [{ messageId: 'notFirst', data: { channel: '?' } }],
    },
    {
      code: `electronIpc.handleOnce('x', function (event) { run(); });`,
      options: [{ receivers: ['electronIpc'] }],
      errors: [{ messageId: 'notFirst' }],
    },
  ],
});
