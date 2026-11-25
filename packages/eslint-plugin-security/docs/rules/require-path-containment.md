# `noctcore-security/require-path-containment`

> Request-shaped input reaching `path.join` / `path.resolve` or the path of an `fs` call without a containment test is a path-traversal sink.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

```ts bad
// `../../../etc/passwd` escapes the intended directory
const file = path.join(baseDir, req.params.file);
```

A crafted `req.params.file` of `../../etc/passwd` walks out of `baseDir` and reads an arbitrary file.
The safe pattern is to resolve, then verify the result still lives under the base directory and a
separator before touching the filesystem:

```ts good
// verify containment
const resolved = path.resolve(baseDir, req.params.file);
if (!resolved.startsWith(baseDir + path.sep)) throw new ForbiddenError();
```

The separator matters: without it, `/srv/app-evil/secret` passes a test for `/srv/app`.

## What it flags

Deliberately **narrow** to stay high-precision without type information. It fires only when:

- a member expression rooted at a request object (`req.*` / `request.*` by default, see
  `requestObjects`) is passed **directly** into `join` or `resolve` from `path` / `node:path`,
  written as `path.join`, through a default or namespace import under any name, or as an imported
  `join` / `resolve` (renamed or not), **and**
- the joined value is never tested for containment in the same function.

```ts bad
import { join } from 'node:path';

export function download(req) {
  return join(uploadsDir, req.params.file);
}
```

A test takes the joined value and a base the requester does not pick:

- `full.startsWith(base + sep)`, where the base ends in a separator (`base + path.sep`,
  `` `${base}/` ``, a literal `'/srv/app/'`, or a `const` holding one of those);
- a `path.relative(base, full)` result refused both when it climbs and when it is absolute
  (`path.isAbsolute(rel)`): on Windows, `relative` across drives returns an absolute path that does
  not start with `..`. A climb is refused by `rel.startsWith('..')`, or by both `rel === '..'` and
  `rel.startsWith('..' + path.sep)`;
- a call to a helper named in `containmentGuards` that takes the joined value.

A base every path is under proves nothing: `'/'`, `''`, `'.'`, `path.sep`, `process.cwd()` and
`path.resolve()` are not bases, for `startsWith` and for `relative`.

The test counts only when its result decides whether the joined value is used: an `if` that
returns, throws, breaks or continues when the path is outside (all that follows it is checked), an `if`, `?:`, `&&` or
`||` around the use, or a `containmentGuards` helper called as a statement before it. A test whose
result is ignored (`full.startsWith(base + sep);`), one that guards some other statement
(`if (inside) log()`), and one inside a nested function that may never run do not count:

```ts bad
import path from 'node:path';

export function resolveUpload(req) {
  const full = path.join(uploadsDir, req.params.file);
  if (full.startsWith(uploadsDir + path.sep)) console.log('inside');
  return full;
}
```

The joined value is the variable the join is stored in, plus any variable initialised from it
through `normalize`, `realpath`, or a one argument `join` / `resolve`. A join that adds another
segment (`join(full, req.query.name)`) makes a new value that needs its own test. A test of some
other string does not count:

```ts bad
// the guard tests the raw name, not the path that is used
function serve(req) {
  if (req.params.file.startsWith('.')) throw new ForbiddenError();
  return path.join(baseDir, req.params.file);
}
```

`path.normalize` on its own is not a test: it resolves `..` segments, so it happily returns a path
outside the base directory.

### Filesystem sinks

The path argument of an `fs` call is followed back through the function: `readFile`,
`writeFile`, `appendFile`, `unlink`, `rm`, `rmdir`, `mkdir`, `mkdtemp`, `readdir`, `stat`,
`lstat`, `statfs`, `exists`, `open`, `openAsBlob`, `opendir`, `access`, `truncate`, `chmod`,
`lchmod`, `chown`, `lchown`, `utimes`, `lutimes`, `createReadStream`, `createWriteStream`,
`readlink`, `realpath`, `watch`, `watchFile`, `unwatchFile`, `glob` and their `Sync` forms, both
paths of `copyFile`, `cp`, `rename`, `link` and `symlink`, and Express `res.sendFile` /
`res.download`. The fs module is recognised as `fs`, `fsp`, `fsPromises`, `fs.promises`, and a
static import, `require`, dynamic `import()` (awaited or not) or `import fs = require(...)` of
`fs`, `node:fs`, `fs/promises` or `node:fs/promises` under any name, also inside a function
(`const { readFile } = await import('node:fs')`), with aliases (`const p = fs.promises`,
`const { unlink } = p`), named imports, a nested destructure
(`const { promises: { readFile } } = require('fs')`), type wrappers (`(fs as any).readFileSync`)
and string keys (`fs['readFileSync']`).

`fs-extra` (and `fs-extra/esm`) counts as an fs module too, with the functions it re-exports from
`fs` and its own: `emptyDir`, `ensureDir`, `mkdirp`, `mkdirs`, `ensureFile`, `createFile`,
`outputFile`, `outputJson`, `pathExists`, `readJson`, `writeJson`, `remove` and their `Sync`
forms, and both paths of `copy`, `move`, `ensureLink`, `createLink`, `ensureSymlink` and
`createSymlink`.

`res.sendFile(path, { root })` and `res.download(path, name, { root })` are checked on the `root`
instead: with a root, Express decodes the path, refuses any `..` segment and serves it under the
root. Fastify's `reply.sendFile` / `reply.download` (`@fastify/static`) serve under the root
registered with the plugin and refuse `..` segments, so only a root the call passes is checked:
`reply.sendFile(file, rootPath)`, `reply.sendFile(file, { root })` and
`reply.download(file, name, { root })`.

A root that confines nothing is not a root, and the served path is checked instead: `'/'`, `''`
(Express then serves the path as given), `null`, `path.sep`, and an environment value that may be
unset or empty (`process.env.FILES`, `process.env.FILES ?? '/srv'`; `process.env.FILES || '/srv'`
falls back to a fixed root and counts). A spread after the root (`{ root: BASE, ...req.body.opts }`)
can replace it, so the spread value is checked as a root too, as is a spread options object with no
`root` (`reply.sendFile('a.txt', { ...req.query })`).

```ts bad
export function serve(req, res) {
  res.sendFile(req.params.file, { root: process.env.FILES_DIR });
}
```

The path is reported when request-shaped input reaches it through:

- `const` and `let` bindings (every assignment, including in `try` / `catch`), destructuring and
  `for...of`;
- string building (`+`, templates, `?:`, `||`, `??`);
- member access (`JSON.parse(x).value`, `parts[0]`) and object or array literals holding it,
  getters included;
- any call that takes it as an argument, receiver or callee (`decodeURIComponent(x)`,
  `x.split(',').join(' ')`, a closure `read()` built from it);
- `arr.push(x)` into an array that later becomes the path;
- a request object destructured in the body (`const { query } = req`), or a request field
  destructured from a handler's first parameter (`({ query }) => ...`,
  `({ params: { file } }) => ...`, under `query`, `params`, `body`, `headers`, `cookies`, `files`,
  `file` or `request`).

```ts bad
import fs from 'node:fs';

export function read(req, res) {
  const name = String(req.query.file).trim();
  res.send(fs.readFileSync('/srv/files/' + name, 'utf8'));
}
```

The flow stops at:

- `path.extname(x)` (an empty string, `.` or `.ext`: never `..`, no separator), a number conversion
  (`Number`, `parseInt`, `parseFloat`), or a callee named in `sanitizers`;
- a read from an in-file `const` table of literal file names (`FILES[id]`, `MAP.get(id)`);
- a confined schema's output, including a field of a parsed `z.object(...)`, whose regex admits no
  separator and cannot match `.`, `..` or an empty value;
- a binding the function checked before the call with an `if` that exits (or an `if` around the
  call): an allowlist (`includes` / `has` on in-file literals, `===` against literals), or a regex
  anchored at both ends, without the `m` flag or a `.`, that admits no `/`, `\` or `:` and cannot
  match `.`, `..` or an empty value (`/^[\w-][\w.-]*$/` passes, `/^[\w.-]+$/` does not);
- `path.basename(x)` stored in a binding that is refused as both `.` and `..` before the call
  (`if (name === '.' || name === '..') return`, `if (name.startsWith('.')) return`,
  `if (['.', '..'].includes(name)) return`, or a regex test that matches both), and as `''` too
  before a call that acts on a directory (`rm`, `rmdir`, `readdir`, `opendir`, `cp`, `rename`,
  `chmod`, `chown`, `symlink`, fs-extra `remove`, `emptyDir`, `copy`, `move`): `basename('/')`
  is `''` and `join(BASE, '')` is `BASE` itself, so `rmSync(join(BASE, name), { recursive: true })`
  deletes the whole base. `!name`, `name === ''`, `name.length === 0`, `''` in the list, or a regex
  that matches `''` (`/^\.{0,2}$/`) refuses it. A `g` or `y` regex
  counts only when it is written at the test, since a shared one keeps `lastIndex` between calls,
  and a `y` regex is read as anchored at the start: `/\.$/y.test('..')` is false).
  The check holds only for that binding read as it is: a part of it or a call on it is new text
  (`'...'` passes the check, and `path.parse('...').name` and `basename('...', extname('...'))`
  are `..`). A bare `basename`
  is not containment: `basename('..')` is `'..'`, so `join(BASE, basename(name), 'profile.json')`
  reads `BASE/../profile.json` and `rm(join(BASE, basename(name)), { recursive: true })` deletes
  the parent of `BASE`. Both refusals have to sit in one test;
- a path built by `join` / `resolve` (or `normalize`, `realpath`) when a containment test above
  takes it and runs before the call on every path to it: an `if` that exits, an `if` around the
  call, or a call to a `containmentGuards` helper as a statement before it.

A request member checked against a literal allowlist
(`if (!allowed.includes(req.params.name)) return res.status(404).end()`) is clean where it is used
next, also directly in `join(BASE, req.params.name)`, as long as nothing can change that member or
an object on its path: a write (`req.params.name = x`, `req.params[key] = x`,
`(req.params as P).name = x`, `Object.assign(req.params, x)`), or an object on the path handed on
(`const p = req.params`, `const { params } = req`, `mutate(req)`), after which writes through the
alias are not seen. Only looking at the object (`if (req.params)`, `typeof req.params`) keeps it
clean. A regex check on a member does not count.

A proof holds only for the text it checked. Below a call that is not known to keep its arguments'
text, and below a member read of a checked value, the checks above no longer cut the flow. Calls
that keep the text are `path.join`, `path.resolve`, `path.normalize`, a one argument
`path.basename`, the global `String`, `encodeURIComponent` and `encodeURI` (not a local function
of that name), the checked value's own methods `toLowerCase`, `toUpperCase`, `toLocaleLowerCase`,
`toLocaleUpperCase`, `toString` and `valueOf`, and `join` or `concat` on a literal
(`[name, 'txt'].join('.')`, `'v1-'.concat(name)`). A method of any other object that takes the
checked value (`qs.join(name)`, `lib.concat(name)`, `x.toString(name)`) is not known to be the
string or array one. Everything else is new text: a decoder (`decodeURIComponent`, `atob`,
`Buffer.from(x, 'base64')`, and `new URL(x)` and `fileURLToPath`, which read `%2e%2e` as `..`),
another string method (`replace`, `slice`, `trim`, `normalize('NFKC')`), `path.parse(x).name`,
`basename(x, ext)`, a library or local helper. `%2e%2e` passes a dot check and decodes to `..`,
and `'a..'.slice(1)` is `..`. Decode first, then check.

```ts bad
import fs from 'node:fs';
import path from 'node:path';

export function remove(req) {
  // basename('..') is '..': this deletes the parent of /srv/files
  fs.rmSync(path.join('/srv/files', path.basename(String(req.query.file))), { recursive: true });
}
```

```ts good
import fs from 'node:fs';
import path from 'node:path';

export function remove(req) {
  const name = path.basename(String(req.query.file));
  // basename('/') is '': join('/srv/files', '') would delete the whole folder
  if (!name || name === '.' || name === '..') return;
  fs.rmSync(path.join('/srv/files', name), { recursive: true });
}
```

```ts good
import fs from 'node:fs';

const FILES = new Set(['terms.md', 'privacy.md']);

export function read(req, res) {
  const name = String(req.query.file).trim();
  if (!FILES.has(name)) return res.status(404).end();
  res.send(fs.readFileSync('/srv/files/' + name, 'utf8'));
}
```

A `join` with a direct `req.*` argument is reported once, at the join, not again at the fs call.

### Helpers

A call to a local function (a declaration, or a `const` or a `let` never reassigned that holds one)
that passes one of its parameters to an fs path with no containment check is reported at the call,
with the message id `unguardedFsHelper`, when request input reaches that argument. A destructured
parameter (`function load({ name })`, `([name])`) counts too: for an object literal argument, only
the keys whose bindings reach the path are checked. One level only: a helper that hands the path to
another helper is not followed, and neither is a method (`this.load(...)`).

```ts bad
import fs from 'node:fs';

function load(name) {
  return fs.readFileSync('/srv/files/' + name, 'utf8');
}

export function read(req, res) {
  res.send(load(req.query.file));
}
```

```ts good
import fs from 'node:fs';

const FILES = ['terms.md', 'privacy.md'];

function load(name) {
  return fs.readFileSync('/srv/files/' + name, 'utf8');
}

export function read(req, res) {
  if (!FILES.includes(req.query.file)) return res.status(404).end();
  res.send(load(req.query.file));
}
```

### Escape hatch

If a flagged site is already safe, add a comment containing `path-containment` anywhere in the
function:

```ts good
function serve(req) {
  // path-containment: base is a fixed constant and req.params.file is validated upstream
  return path.join(base, req.params.file);
}
```

## What it does not flag

Because a sanitized value is normally bound to a local first (`const safe = clean(req.x)` then
`path.join(base, safe)`), that shape is **not** a direct `req.*` argument and is never flagged.

```ts good
// sanitized into a local: not a direct req.* argument
const safe = sanitize(req.params.file);
return path.join(base, safe);
```

A `join` or `resolve` imported from any other module (lodash, a DI container) is not a path builder.

A `readFile` that is not the fs module's (`storage.readFile`, a local function) is not a sink. Flow
across functions is followed one call deep (see Helpers), not further.

Symbolic links are not modelled: a path that passes the containment test can still be a link that
points outside the base. Compare `fs.realpath` results when the directory can hold links the
requester controls. `path.posix` and `path.win32` are never read as containment or as a sanitizer
(`path.posix.basename` keeps `\`, which Windows reads as a separator). `path.extname` counts as a
sanitizer even though it can return `.`, so gluing it to another lone `.` (`'.' + extname(x)`)
can make `..`; that shape is not modelled. On Windows, Win32 trims a trailing dot or space from a
path segment, so `'.. '` passes a `..` check and then names the parent; the dot checks compare
the text as written. A regex sanitizer that admits no space avoids it.

Broader user-input sources (arbitrary handler parameters, decoded JWT or payload fields) are not
tracked by default. Proving them user-shaped needs type or dataflow analysis this syntactic rule
cannot do soundly. When you know a source, name its root object in `requestObjects`; for example a
settings object a renderer process can write:

```ts bad options={"requestObjects":["settings"]}
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

export async function clearSprite(settings) {
  await rm(join(spritesDir, settings.mascotCustomSprite));
}
```

```ts good options={"requestObjects":["settings"]}
import { join, sep } from 'node:path';
import { rm } from 'node:fs/promises';

export async function clearSprite(settings) {
  const target = join(spritesDir, settings.mascotCustomSprite);
  if (!target.startsWith(spritesDir + sep)) throw new Error('outside the sprites directory');
  await rm(target);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requestObjects` | `string[]` | `['req', 'request']` | Root object names treated as request-shaped input. |
| `containmentGuards` | `string[]` | `[]` | Names of project helpers that verify containment; a call to one that takes the joined value counts as a test. |
| `sanitizers` | `string[]` | `[]` | Callees (source text) whose result is a safe file name (never `.` or `..`, no separator), so request input passed through one does not reach an fs path. |

```js
'noctcore-security/require-path-containment': [
  'error',
  { requestObjects: ['req', 'request', 'ctx'], containmentGuards: ['assertInside'], sanitizers: ['toSafeName'] },
]
```

## When not to use it

This is a **high-false-positive family**, which is why it is omitted from the `recommended` preset.
Enable it explicitly at `error` once you have confirmed your codebase's `req.*`-into-`path` and
`req.*`-into-`fs` call sites are worth auditing; scope it with `files` to the directories you are
ready to fix.
