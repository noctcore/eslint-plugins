# `eslint-override-paths-exist`

> Every path written in an ESLint flat config `files` or `ignores` entry exists, so a moved folder cannot leave an override that applies to nothing.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createEslintOverridePathsExistRule` from `@noctcore/lint-meta-rules` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

An override is a set of patterns, and ESLint says nothing about a pattern that matches nothing. Move
`src/legacy/` to `src/compat/`, and the block that turned a rule off for the old folder, or switched
on a stricter one for it, stops applying without a word: the new folder is linted with the wrong
rules, and the stale block stays in the config looking deliberate.

## What it flags

In every `eslint.config.{js,mjs,cjs,ts,mts,cts}` (at any depth, resolved against that config's own
directory):

- A literal `files` entry that does not exist.
- A `files` glob whose literal directory does not exist (`legacy` in `legacy/**/*.ts`).
- A literal `ignores` or `globalIgnores([...])` entry that names one file (a directory and an
  extension, such as `src/routeTree.gen.ts`) that does not exist.

```js
// apps/web/eslint.config.js, with src/legacy moved away: reported twice
export default [
  { files: ['src/legacy/**/*.ts'], rules: { 'no-console': 'off' } },
  { files: ['src/routeTree.gen.ts'], rules: { 'max-lines': 'off' } },
];
```

## What it does not flag

- A glob with no literal directory (`**/*.test.ts`): it matches zero or more files by design.
- Directory and glob `ignores` (`dist`, `coverage/`, `**/*.gen.ts`): they usually name build output
  that a clean checkout does not have yet.
- A negated entry (`!src/keep.ts`): it only narrows what another entry matched.
- Paths in comments, in imports, under any other key, and computed template strings.

## Options

```ts
createEslintOverridePathsExistRule(options?: EslintOverridePathsExistOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `configGlobs` | `string[]` | `['**/eslint.config.{js,mjs,cjs,ts,mts,cts}']` | Flat config files to read. `node_modules`, `dist` and similar are always skipped. |
| `checkGlobPrefixes` | `boolean` | `true` | Also require the literal directory a `files` glob starts in to exist. |
| `checkIgnores` | `boolean` | `true` | Also check one-file `ignores` entries. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

The config is read as text, not run: an entry built in code (a variable, a `.map()`) is not seen,
and an object with its own `basePath` is still resolved against the config's directory.

## When not to use it

If your overrides are all generated (a shared preset with no paths of your own), there is nothing
for it to check.
