# `noctcore-architecture/colocated-test-required`

> A source file matching an `include` glob must have a colocated `*.test.*` / `*.spec.*` sibling on disk. Off until `include` is configured.

## Why

Some files are risky enough that shipping them untested should be a lint error, not a code-review
afterthought — hooks, services, reducers, money math. This rule lets you name those globs and then
requires each matching file to carry its test right next to it, so the test travels with the code and
is obvious when missing.

## What it flags

For a file matching `include`, the rule reads the file's directory and looks for a sibling whose name
is `<stem>.test.<ext>` or `<stem>.spec.<ext>` (any extension). If none exists, it reports.

```
src/hooks/useCart.ts          ← include: ['**/use*.ts']
src/hooks/useCart.test.ts      ✓ colocated test present
src/hooks/useWishlist.ts       ✗ no useWishlist.test.* / .spec.* sibling
```

A test file that itself matches `include` is never asked to test itself. Directory listings are
cached for the lint run, so a folder full of gated files is read once.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `include` | `string[]` | `[]` | Globs of source files that must have a colocated test. **Empty = the rule is off.** |
| `ignore` | `string[]` | `[]` | Globs of files to exempt even when they match `include`. |

```js
'noctcore-architecture/colocated-test-required': ['error', {
  include: ['**/use*.ts', '**/*.service.ts', '**/*.reducer.ts'],
  ignore: ['**/*.d.ts'],
}]
```

## In `recommended`

Ships **`'off'`**. There is no universal "everything needs a colocated test" default, so the
`recommended` preset cannot safely enable it — turn it on with your own `include` globs.

## When not to use it

If your tests live in a separate `__tests__` tree or a top-level `test/` directory rather than beside
the source, this colocation check does not model your layout. Leave it off.
