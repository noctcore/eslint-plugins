# `noctcore-security/require-path-containment`

> Request-shaped input flowing directly into `path.join` / `path.resolve` without a containment guard is a path-traversal sink. **Opt-in — not in `recommended`.**

## Why

```ts
// ✗ `../../../etc/passwd` escapes the intended directory
const file = path.join(baseDir, req.params.file);
```

A crafted `req.params.file` of `../../etc/passwd` walks out of `baseDir` and reads an arbitrary file.
The safe pattern is to resolve, then verify the result still lives under the base directory before
touching the filesystem:

```ts
// ✓ verify containment
const resolved = path.resolve(baseDir, req.params.file);
if (!resolved.startsWith(baseDir)) throw new ForbiddenError();
```

## What it flags

Deliberately **narrow** to stay high-precision without type information. It fires only when:

- a `req.*` / `request.*` member expression is passed **directly** into `path.join(...)` or
  `path.resolve(...)`, **and**
- the enclosing function contains no containment guard.

A guard is any `path.normalize` / `path.relative` / `.startsWith(...)` call in the same function, or
the escape-hatch comment convention (below). Because a sanitized value is normally bound to a local
first (`const safe = clean(req.x)` → `path.join(base, safe)`), that shape is **not** a direct `req.*`
argument and is never flagged.

```ts
// ✓ sanitized into a local — not a direct req.* argument
const safe = sanitize(req.params.file);
return path.join(base, safe);
```

### Escape hatch

If a flagged site is already safe, add a comment containing `path-containment` anywhere in the
function:

```ts
function serve(req) {
  // path-containment: base is a fixed constant and req.params.file is validated upstream
  return path.join(base, req.params.file);
}
```

## Not covered (by design)

Broader user-input sources — arbitrary handler parameters, decoded JWT/payload fields — are **out of
scope**. Proving them user-shaped needs type or dataflow analysis this syntactic rule cannot do
soundly, and guessing would flood the codebase with false positives. Only the unambiguous `req.*` /
`request.*` root is tracked.

## Options

```ts
type Options = {
  /** Root object names treated as request-shaped input. Default: ['req', 'request']. */
  requestObjects?: string[];
};
```

## When not to use it

This is a **high-false-positive family**, which is why it is omitted from the `recommended` preset.
Enable it explicitly (as `warn` first) once you have confirmed your codebase's `req.*`-into-`path`
call sites are worth auditing.
