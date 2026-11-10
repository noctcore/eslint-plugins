# `tsconfig-include-paths-exist`

> Every literal path in a tsconfig `include` or `files`, and the directory each glob entry starts in, exists.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTsconfigIncludePathsExistRule` from `@noctcore/lint-meta-rules` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

`include` is a set of patterns, so tsc says nothing about an entry that matches nothing. Rename
`scripts/` to `tools/` and leave `"include": ["src", "scripts"]` alone, and `tools/` simply stops
being type checked: every type error in it disappears from a green `tsc --noEmit`. A missing `files`
entry does stop tsc, but only when that exact config is compiled; an editor-only or
tool-only config fails nowhere.

## What it flags

In every `tsconfig.json` and `tsconfig.*.json` (at any depth, resolved against that config's own
directory):

- A literal `include` or `files` entry that does not exist.
- A glob entry whose literal directory does not exist (`scripts` in `scripts/**/*.ts`).

```jsonc
// apps/web/tsconfig.json, after scripts/ moved to tools/: reported
{
  "include": ["src", "scripts/**/*.ts"],
}
```

Comments and trailing commas are read as tsc reads them.

## What it does not flag

- A glob with no literal directory (`**/*.d.ts`).
- An entry with a hidden segment (`.astro/types.d.ts`, `.storybook`): a tool that has not
  necessarily run in this checkout generates it.
- A path that climbs out of the config (`../shared`) when that path exists.
- `${configDir}` is read as the config's own directory.
- A config that does not parse: tsc reports that itself.

## Options

```ts
createTsconfigIncludePathsExistRule(options?: TsconfigIncludePathsExistOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tsconfigGlobs` | `string[]` | `['**/tsconfig.json', '**/tsconfig.*.json']` | Configs to read. `node_modules`, `dist` and similar are always skipped. |
| `checkGlobPrefixes` | `boolean` | `true` | Also require the literal directory a glob entry starts in to exist. |
| `skipHiddenEntries` | `boolean` | `true` | Skip entries with a hidden segment. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

Each config is read on its own: an `include` inherited through `extends` is checked in the config
that writes it, relative to that config.

## When not to use it

If every tsconfig includes only globs from the package root (`**/*.ts`), there is nothing for it to
check.
