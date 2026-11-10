# `noctcore-security/require-path-containment`

> Request-shaped input passed directly into `path.join` / `path.resolve` without a containment test on the result is a path-traversal sink.

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

```js
'noctcore-security/require-path-containment': [
  'error',
  { requestObjects: ['req', 'request', 'ctx'], containmentGuards: ['assertInside'] },
]
```

## When not to use it

This is a **high-false-positive family**, which is why it is omitted from the `recommended` preset.
Enable it explicitly at `error` once you have confirmed your codebase's `req.*`-into-`path` call
sites are worth auditing; scope it with `files` to the directories you are ready to fix.
