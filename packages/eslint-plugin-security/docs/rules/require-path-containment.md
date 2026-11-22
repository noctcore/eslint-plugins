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
The safe pattern is to resolve, then verify the result still lives under the base directory before
touching the filesystem:

```ts good
// verify containment
const resolved = path.resolve(baseDir, req.params.file);
if (!resolved.startsWith(baseDir)) throw new ForbiddenError();
```

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

A test is a call that takes the joined value: `full.startsWith(...)`, `path.relative(base, full)`,
or a helper named in `containmentGuards`. The joined value is the variable the join is stored in,
plus any variable initialised from it through `join`, `resolve` or `normalize`. A test of some other
string does not count:

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

The path argument of an `fs` call that reads, writes or deletes is followed back through the
function: `readFile`, `writeFile`, `appendFile`, `unlink`, `rm`, `rmdir`, `mkdir`, `readdir`,
`stat`, `lstat`, `open`, `opendir`, `access`, `truncate`, `chmod`, `chown`, `createReadStream`,
`createWriteStream`, `readlink`, `realpath` and their `Sync` forms, both paths of `copyFile`, `cp`,
`rename`, `link` and `symlink`, and Express `res.sendFile` / `res.download`. The fs module is
recognised as `fs`, `fsp`, `fsPromises`, `fs.promises`, a `require` or import of `fs`,
`node:fs`, `fs/promises` or `node:fs/promises` under any name, and named imports of those
functions.

The path is reported when request-shaped input reaches it through:

- `const` and `let` bindings (every assignment, including in `try` / `catch`), destructuring and
  `for...of`;
- string building (`+`, templates, `?:`, `||`, `??`);
- member access (`JSON.parse(x).value`, `parts[0]`) and object or array literals holding it,
  getters included;
- any call that takes it as an argument, receiver or callee (`decodeURIComponent(x)`,
  `x.split(',').join(' ')`, a closure `read()` built from it);
- `arr.push(x)` into an array that later becomes the path.

```ts bad
import fs from 'node:fs';

export function read(req, res) {
  const name = String(req.query.file).trim();
  res.send(fs.readFileSync('/srv/files/' + name, 'utf8'));
}
```

The flow stops at `path.basename(x)` and `path.extname(x)` (neither keeps a separator), a number
conversion (`Number`, `parseInt`, `parseFloat`), a callee named in `sanitizers`, a read from an
in-file `const` table of literal file names (`FILES[id]`, `MAP.get(id)`), a confined schema's output
(including a field of a parsed `z.object(...)` whose schema admits no separator), and at a binding the function checked before the call with an `if`
that exits (or an `if` around the call): an allowlist (`includes` / `has` on in-file literals,
`===` against literals) or a regex anchored at both ends, without the `m` flag or a `.`, that
admits no `/`, `\` or `:`. A path built by `join` / `resolve` passes when the containment test
above takes it.

```ts good
import fs from 'node:fs';
import path from 'node:path';

export function read(req, res) {
  const name = String(req.query.file).trim();
  res.send(fs.readFileSync('/srv/files/' + path.basename(name), 'utf8'));
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
across functions is not followed: a handler that passes `req.params.file` to a helper which builds
the path is not seen.

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
| `sanitizers` | `string[]` | `[]` | Callees (source text) whose result is a safe file name, so request input passed through one does not reach an fs path. `path.basename` always counts. |

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
