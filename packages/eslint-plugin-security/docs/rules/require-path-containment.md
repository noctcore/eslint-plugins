# `noctcore-security/require-path-containment`

> Request-shaped input flowing directly into `path.join` / `path.resolve` without a containment guard is a path-traversal sink. **Opt-in — not in `recommended`.**

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

- a `req.*` / `request.*` member expression is passed **directly** into `path.join(...)` or
  `path.resolve(...)`, **and**
- the enclosing function contains no containment guard.

A guard is any `path.normalize` / `path.relative` / `.startsWith(...)` call in the same function, or
the escape-hatch comment convention (below).

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

Because a sanitized value is normally bound to a local first (`const safe = clean(req.x)` →
`path.join(base, safe)`), that shape is **not** a direct `req.*` argument and is never flagged.

```ts good
// sanitized into a local: not a direct req.* argument
const safe = sanitize(req.params.file);
return path.join(base, safe);
```

Broader user-input sources — arbitrary handler parameters, decoded JWT/payload fields — are **out of
scope**. Proving them user-shaped needs type or dataflow analysis this syntactic rule cannot do
soundly, and guessing would flood the codebase with false positives. Only the unambiguous `req.*` /
`request.*` root is tracked.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `requestObjects` | `string[]` | `['req', 'request']` | Root object names treated as request-shaped input. |

```js
'noctcore-security/require-path-containment': ['error', { requestObjects: ['req', 'request', 'ctx'] }]
```

## When not to use it

This is a **high-false-positive family**, which is why it is omitted from the `recommended` preset.
Enable it explicitly at `error` once you have confirmed your codebase's `req.*`-into-`path` call
sites are worth auditing; scope it with `files` to the directories you are ready to fix.
