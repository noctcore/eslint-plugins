import { ruleTester, workspacePath } from '@noctcore/eslint-test-utils';

import { noRendererSettingToFsRule } from '../../src/rules/no-renderer-setting-to-fs';

const MAIN = 'src/main/avatar.ts';
const STORE = [{ sources: [{ object: 'store', method: 'get' }] }];
const LOADER = [{ sources: [{ function: 'loadSettings' }] }];
const KEYED = [{ sources: [{ object: 'store', method: 'get', keys: ['theme.*', 'customAvatarPath'] }] }];
const GETTER = [{ sources: [{ function: 'getSetting', returns: 'value' as const }] }];
const GETTER_KEYED = [{ sources: [{ function: 'getSetting', returns: 'value' as const, keys: ['paths.*'] }] }];
const ALLOWLIST = [{ sources: [{ object: 'store', method: 'get' }], sanitizers: ['includes'] }];
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
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('x'));\n  if (full.startsWith(BASE + path.sep)) fs.readFileSync(full);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // `path.basename` keeps a file sink inside the base: `..` or `.` there names a directory, which a file read refuses.
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
    // A getter source only counts for the keys listed.
    { code: `${FS}fs.readFileSync(getSetting('theme'));`, filename: MAIN, options: GETTER_KEYED },
    { code: `${FS}fs.readFileSync(getSetting(key));`, filename: MAIN, options: GETTER_KEYED },
    // A loader-mode function returns an object: the call itself is not a path.
    { code: `${FS}fs.readFileSync(String(getSetting));`, filename: MAIN, options: GETTER },
    // An allowlist check through a sanitizer named `includes`.
    {
      code: `${FS}function read() {\n  const name = store.get('theme');\n  if (!THEMES.includes(name)) return;\n  return fs.readFileSync(path.join(THEME_DIR, name));\n}`,
      filename: MAIN,
      options: ALLOWLIST,
    },
    // Both tainted operands contained.
    {
      code: `${FS}function read() {\n  const a = path.join(BASE, store.get('a'));\n  const b = path.join(BASE, store.get('b'));\n  if (!a.startsWith(BASE + path.sep) || !b.startsWith(BASE + path.sep)) return;\n  fs.copyFileSync(a, b);\n}`,
      filename: MAIN,
      options: STORE,
    },
    // A containment test that decides whether the read runs, against a base that ends in a separator.
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (full.startsWith(BASE + path.sep)) return fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nreturn full.startsWith(BASE + path.sep) && fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst rel = path.relative(BASE, full);\nif (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst ok = full.startsWith(BASE + path.sep);\nif (!ok) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve('/srv/data', store.get('x'));\nif (!full.startsWith('/srv/data/')) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (path.relative(BASE,full) === '..' || path.relative(BASE, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(BASE, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
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
    // `path.basename` does not contain a directory sink: '..' stays '..', and '' or '.' is the base itself.
    {
      code: `${FS}fs.rmSync(path.join(DIR, path.basename(store.get('a'))), { recursive: true });`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `${FS}function list() {\n  const name = path.basename(store.get('folder'));\n  return fs.readdirSync(path.join(DIR, name));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `import { shell } from 'electron';\nimport path from 'node:path';\nshell.openPath(path.join(DIR, path.basename(store.get('folder'))));`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `import { shell } from 'electron';\nimport path from 'node:path';\nshell.trashItem(path.join(DIR, path.basename(store.get('folder'))));`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `import { cp, rename, opendir, rmdir } from 'node:fs/promises';\nimport { basename, join } from 'node:path';\nasync function f() {\n  await cp(join(DIR, basename(store.get('a'))), OUT);\n  await rename(OUT, join(DIR, basename(store.get('b'))));\n  await opendir(join(DIR, basename(store.get('c'))));\n  await rmdir(join(DIR, basename(store.get('d'))));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR, ERROR, ERROR, ERROR],
    },
    // A contained first setting does not hide a second one beside it.
    {
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('a'));\n  if (!full.startsWith(BASE + path.sep)) throw new Error('outside');\n  return fs.readFileSync(path.join(full, store.get('b')));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('a'));\n  if (!full.startsWith(BASE + path.sep)) throw new Error('outside');\n  return fs.readFileSync(full + store.get('b'));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `${FS}function read() {\n  const full = path.resolve(BASE, store.get('a'));\n  if (!full.startsWith(BASE + path.sep)) throw new Error('outside');\n  return fs.readFileSync(\`\${full}/\${store.get('b')}\`);\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // A getter function whose return value is the setting.
    {
      code: `${FS}fs.readFileSync(getSetting('dir'));`,
      filename: MAIN,
      options: GETTER,
      errors: [ERROR],
    },
    {
      code: `${FS}function f() {\n  const dir = this.getSetting('paths.export');\n  return fs.writeFileSync(path.join(dir, 'out.json'), data);\n}`,
      filename: MAIN,
      options: GETTER_KEYED,
      errors: [ERROR],
    },
    // chmod and symlink act on a directory too: a basename of '..' changes or links the parent.
    {
      code: `${FS}fs.chmodSync(path.join(D, path.basename(store.get('a'))), 0o777);`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: `${FS}async function f() {\n  await fs.promises.chmod(path.join(D, path.basename(store.get('a'))), 0o755);\n  fs.symlinkSync(path.join(D, path.basename(store.get('b'))), LINK);\n  await fs.promises.symlink(TARGET, path.join(D, path.basename(store.get('c'))));\n}`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR, ERROR, ERROR],
    },
    // A computed member callee with a string key is the same source.
    {
      code: `${FS}fs.readFileSync(settings['getSetting']('dir'));`,
      filename: MAIN,
      options: GETTER,
      errors: [ERROR],
    },
    {
      code: `${FS}fs.readFileSync(this['store']['get']('dir'));`,
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // A containment test counts only when its result decides whether the read runs, against a base that ends in a
    // separator, and a relative result taken against a base that is not '/' or the working directory.
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nfull.startsWith(BASE + path.sep);\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (full.startsWith(BASE + path.sep)) log('inside');\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst check = () => {\n  if (!full.startsWith(BASE + path.sep)) throw new Error('outside');\n};\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nfull.startsWith(BASE);\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst ok = full.startsWith('/srv/data');\nif (!ok) throw new Error('outside');\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (full.startsWith(BASE)) return fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (!full.startsWith(BASE)) throw new Error('outside');\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\npath.relative(BASE, full);\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst rel = path.relative(BASE, full);\nif (rel === '') return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst rel = path.relative(BASE, full);\nif (rel === '..' || rel.startsWith('..' + path.sep)) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst rel = path.relative('/', full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst rel = path.relative(process.cwd(), full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // Refusals of two different inline relative calls do not pair up.
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (path.relative(BASE + '/sub', full) === '..' || path.relative(BASE, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(BASE, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    // Relative calls pair up only on the same base: not a base written in between, a member read, or other string text.
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nlet b = BASE + '/sub';\nif (path.relative(b, full) === '..' || (b = BASE) === '' || path.relative(b, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(b, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nlet b = BASE + '/sub';\nconst set = () => { b = BASE; return false; };\nif (path.relative(b, full) === '..' || set() || path.relative(b, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(b, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nconst o = { b: BASE };\nif (path.relative(o.b, full) === '..' || path.relative(o.b, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(o.b, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nlet n = 0;\nconst o = { get b() { n += 1; return n === 1 ? BASE + '/sub' : BASE; } };\nif (path.relative(o.b, full) === '..' || path.relative(o.b, full).startsWith('..' + path.sep) || path.isAbsolute(path.relative(o.b, full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
    {
      code: "import fs from 'node:fs';\nimport path from 'node:path';\nfunction read() {\nconst full = path.resolve(BASE, store.get('x'));\nif (path.relative('/srv/data/s ub', full) === '..' || path.relative('/srv/data/sub', full).startsWith('..' + path.sep) || path.isAbsolute(path.relative('/srv/data/sub', full))) return;\nreturn fs.readFileSync(full);\n}",
      filename: MAIN,
      options: STORE,
      errors: [ERROR],
    },
  ],
});
