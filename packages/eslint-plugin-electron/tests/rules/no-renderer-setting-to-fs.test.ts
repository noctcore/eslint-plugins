import { ruleTester, workspacePath } from '@noctcore/eslint-test-utils';

import { noRendererSettingToFsRule } from '../../src/rules/no-renderer-setting-to-fs';

const MAIN = 'src/main/avatar.ts';
const STORE = [{ sources: [{ object: 'store', method: 'get' }] }];
const LOADER = [{ sources: [{ function: 'loadSettings' }] }];
const KEYED = [{ sources: [{ object: 'store', method: 'get', keys: ['theme.*', 'customAvatarPath'] }] }];
const GUARDED = [
  { sources: [{ object: 'store', method: 'get' }], sanitizers: ['assertInside', 'isInside'] },
];

const FS = `import fs from 'node:fs';\nimport path from 'node:path';\n`;
const ERROR = { messageId: 'settingToFs' as const };

ruleTester.run('no-renderer-setting-to-fs', noRendererSettingToFsRule, {
  valid: [
    // Without sources the rule has nothing to follow.
    { code: `${FS}fs.readFile(store.get('customAvatarPath'), cb);`, filename: MAIN },
    // The renderer side of the shape: it writes the setting through IPC.
    {
      code: `import { ipcRenderer } from 'electron';\nexport const setAvatar = (file: string) => ipcRenderer.invoke('settings:set', 'customAvatarPath', file);`,
      filename: 'src/renderer/settings.ts',
      options: STORE,
    },
    // The main-process handler that stores it touches no file.
    {
      code: `import { ipcMain } from 'electron';\nipcMain.handle('settings:set', (_event, key: string, value: unknown) => store.set(key, value));`,
      filename: 'src/main/ipc.ts',
      options: STORE,
    },
    // Contained: resolve under a base and test the result.
    {
      code: `${FS}export async function readAvatar() {\n  const file = store.get('customAvatarPath');\n  const full = path.resolve(AVATAR_DIR, file);\n  if (!full.startsWith(AVATAR_DIR + path.sep)) throw new Error('outside');\n  return fs.promises.readFile(full);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // Contained: `path.relative` guard, then a normalized copy.
    {
      code: `${FS}function read() {\n  const full = path.join(BASE, store.get('theme.backgroundImage'));\n  const rel = path.relative(BASE, full);\n  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;\n  return fs.readFileSync(full);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // Contained in the positive form.
    {
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('x'));\n  if (full.startsWith(BASE)) fs.readFileSync(full);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // `path.basename` strips the directories.
    {
      code: `${FS}function read() {\n  const name = path.basename(store.get('customAvatarPath'));\n  return fs.readFileSync(path.join(AVATAR_DIR, name));\n}`,
      filename: MAIN,
      options: STORE,
    },
    {
      code: `import { readFile } from 'fs/promises';\nimport { basename, join } from 'path';\nasync function read() {\n  return readFile(join(AVATAR_DIR, basename(store.get('customAvatarPath'))));\n}`,
      filename: MAIN,
      options: STORE,
    },
    // A helper that returns a checked path ends the chain.
    {
      code: `${FS}function read() {\n  const safe = resolveInside(AVATAR_DIR, store.get('customAvatarPath'));\n  return fs.readFileSync(safe);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // An assert-style sanitizer before the sink.
    {
      code: `${FS}function read() {\n  const file = store.get('customAvatarPath');\n  assertInside(AVATAR_DIR, file);\n  return fs.readFileSync(file);\n}`,
      filename: MAIN,
      options: GUARDED,
    },
    {
      code: `${FS}function read() {\n  const file = store.get('customAvatarPath');\n  if (!isInside(AVATAR_DIR, file)) return;\n  return fs.readFileSync(file);\n}`,
      filename: MAIN,
      options: GUARDED,
    },
    // A store that is not configured.
    { code: `${FS}fs.readFileSync(cache.get('lastFile'));`, filename: MAIN, options: STORE },
    { code: `${FS}fs.readFileSync(store.load('lastFile'));`, filename: MAIN, options: STORE },
    // A key that is not listed, or one the rule cannot read.
    { code: `${FS}fs.readFileSync(store.get('downloads.folder'));`, filename: MAIN, options: KEYED },
    { code: `${FS}fs.readFileSync(store.get(key));`, filename: MAIN, options: KEYED },
    {
      code: `${FS}const { exportDir } = loadSettings();\nfs.readFileSync(exportDir);`,
      filename: MAIN,
      options: [{ sources: [{ function: 'loadSettings', keys: ['customAvatarPath'] }] }],
    },
    // A `let` is not followed.
    {
      code: `${FS}function read() {\n  let file = store.get('customAvatarPath');\n  file = DEFAULT_AVATAR;\n  return fs.readFileSync(file);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // Not followed across functions.
    {
      code: `${FS}const file = store.get('customAvatarPath');\nexport function read() {\n  return fs.readFileSync(file);\n}`,
      filename: MAIN,
      options: STORE,
    },
    {
      code: `${FS}export function read(file: string) {\n  return fs.readFileSync(file);\n}\nread(store.get('customAvatarPath'));`,
      filename: MAIN,
      options: STORE,
    },
    // A property written later is not followed.
    {
      code: `${FS}function read() {\n  const paths = {} as Record<string, string>;\n  paths.avatar = store.get('customAvatarPath');\n  return fs.readFileSync(paths.avatar);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // The value reaches a call that is not a sink, or a non-path argument.
    { code: `${FS}log.info(store.get('customAvatarPath'));`, filename: MAIN, options: STORE },
    {
      code: `${FS}fs.writeFileSync(SETTINGS_FILE, store.get('customAvatarPath'));`,
      filename: MAIN,
      options: STORE,
    },
    { code: `${FS}fs.readFileSync(path.dirname(store.get('x')));`, filename: MAIN, options: STORE },
    // A `readFile` that is not `fs`.
    { code: `function readFile(p: string) {}\nreadFile(store.get('x'));`, filename: MAIN, options: STORE },
    // Another `shell` method, and Electron's other exports.
    {
      code: `import { shell } from 'electron';\nshell.beep();\nshell.openExternal(store.get('homepage'));`,
      filename: MAIN,
      options: STORE,
    },
    // allowIn skips the file.
    {
      code: `${FS}fs.readFileSync(store.get('x'));`,
      filename: workspacePath('apps', 'desktop', 'src', 'main', 'migrate.ts'),
      options: [{ ...STORE[0], allowIn: ['apps/desktop/src/main/migrate.ts'] }],
    },
  ],
  invalid: [
    // The acceptance shape: the main process reads the setting back and reads the file.
    {
      code: `import fs from 'node:fs/promises';\nimport { ipcMain } from 'electron';\nipcMain.handle('avatar:load', async () => {\n  const file = store.get('customAvatarPath');\n  return fs.readFile(file);\n});`,
      filename: MAIN,
      options: STORE,
      errors: [{ ...ERROR, line: 5 }],
    },
    // Through `path.join` and a template literal.
    {
      code: `${FS}function read() {\n  const file = store.get('theme.backgroundImage');\n  const full = path.join(THEMES_DIR, \`\${file}.png\`);\n  return fs.readFileSync(full);\n}`,
      filename: MAIN,
      options: KEYED,
      errors: [ERROR],
    },
    // A containment test on the raw value is not one on the built path.
    {
      code: `${FS}function read() {\n  const file = store.get('x');\n  if (file.startsWith('.')) return;\n  return fs.readFileSync(path.join(BASE, file));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // A test after the sink is too late.
    {
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('x'));\n  const data = fs.readFileSync(full);\n  if (!full.startsWith(BASE)) throw new Error('outside');\n  return data;\n}`,
      filename: MAIN,
      options: STORE,
      errors: [{ ...ERROR, line: 5 }],
    },
    // `this.store`, `await`, `??` and string concatenation.
    {
      code: `${FS}class Avatars {\n  async read() {\n    const dir = (await this.store.get('exportDir')) ?? DEFAULT_DIR;\n    return fs.promises.readdir(dir + '/avatars');\n  }\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // A loader's settings object, read by member and by destructuring.
    {
      code: `${FS}function read() {\n  const settings = loadSettings();\n  return fs.readFileSync(settings.customAvatarPath);\n}`,
      filename: MAIN,
      options: LOADER,
      errors: [{ ...ERROR, data: { source: 'loadSettings().customAvatarPath', sink: 'a path argument of `fs.readFileSync`' } }],
    },
    {
      code: `${FS}async function read() {\n  const { customAvatarPath: file } = await this.loadSettings();\n  return fs.createReadStream(file);\n}`,
      filename: MAIN,
      options: LOADER,
      errors: [ERROR],
    },
    // Named and promise imports, `require`, and both paths of a copy.
    {
      code: `import { readFile } from 'fs/promises';\nreadFile(store.get('x'));`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `import { promises as fsp } from 'fs';\nfsp.unlink(store.get('x'));`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `const fs = require('original-fs');\nfs.copyFileSync(store.get('from'), store.get('to'));`,
      filename: 'src/main/avatar.js',
      options: STORE,
      errors: [ERROR, ERROR],
    },
    // Electron's `shell` path functions.
    {
      code: `import { shell } from 'electron';\nvoid shell.openPath(store.get('exportDir'));`,
      filename: MAIN,
      options: STORE,
      errors: [{ ...ERROR, data: { source: "store.get('exportDir')", sink: '`shell.openPath`' } }],
    },
    {
      code: `const { shell } = require('electron');\nshell.showItemInFolder(\`\${store.get('exportDir')}/report.pdf\`);`,
      filename: 'src/main/menu.js',
      options: STORE,
      errors: [ERROR],
    },
    // A sanitizer that does not take the value does not guard it.
    {
      code: `${FS}function read() {\n  const file = store.get('x');\n  assertInside(BASE, other);\n  return fs.readFileSync(file);\n}`,
      filename: MAIN,
      options: GUARDED,
      errors: [ERROR],
    },
    // A listed key.
    {
      code: `${FS}fs.rmSync(store.get('customAvatarPath'));`,
      filename: MAIN,
      options: KEYED,
      errors: [ERROR],
    },
  ],
});
