# `noctcore-architecture/file-naming-pattern`

> In a folder matched by `folders`, a file's basename must match `pattern`, a regular expression built from the folder's name.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Many codebases name the files of a folder after the folder: `account/account.routes.ts`,
`account/account.schemas.ts`. Enforcing that with one `no-restricted-syntax` entry per folder is long
and its messages say little. This rule takes one pattern with a `{folder}` placeholder, applies it to
every folder a glob matches, and the message names the pattern the file should have matched.

### In `recommended`

Left out of `recommended` and `strict`. It does nothing until you set `folders` and `pattern`, so a
preset entry would read as coverage the project does not have.

## What it flags

For a file whose immediate parent folder matches `folders`, the rule replaces every `{folder}` in
`pattern` with that folder's name (escaped), and reports the file once, on its first line, when the
basename does not match the result. Renaming the file is the fix.

```ts bad filename=src/account/routes.ts options={"folders":["**/src/*"],"pattern":"^{folder}(\\.[a-z-]+)?\\.ts$"}
export const routes = [];
```

```ts good relocation filename=src/account/account.routes.ts options={"folders":["**/src/*"],"pattern":"^{folder}(\\.[a-z-]+)?\\.ts$"}
export const routes = [];
```

```ts good relocation filename=src/account/account.ts options={"folders":["**/src/*"],"pattern":"^{folder}(\\.[a-z-]+)?\\.ts$"}
export const account = {};
```

## What it does not flag

- Anything, until both `folders` and `pattern` are set.
- A file whose immediate parent folder does not match `folders`. Only that one folder is tested, never
  a deeper ancestor.
- A file matched by `allowIn`, such as `**/index.ts`.
- A folder name is matched literally: a folder named `a.b` does not accept `aXb.ts`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `folders` | `string[]` | `[]` | Globs matched against the folder that directly contains the file. **Empty = the rule is off.** |
| `pattern` | `string` | (none) | Regular expression source for the basename; every `{folder}` is replaced by the escaped parent folder name. **Unset = the rule is off.** |
| `allowIn` | `string[]` | `[]` | Globs of files exempt even when their folder matches `folders`. |

An invalid `pattern` is reported as a configuration problem on the first line of each file it would
apply to, instead of stopping the lint run.

```js
'noctcore-architecture/file-naming-pattern': ['error', {
  folders: ['src/modules/*'],
  pattern: '^{folder}(\\.[a-z-]+)?\\.ts$',
  allowIn: ['**/index.ts'],
}]
```

## When not to use it

If your folders do not name their files after themselves, or the convention differs per folder, one
pattern will not describe your layout. Leave it off.
