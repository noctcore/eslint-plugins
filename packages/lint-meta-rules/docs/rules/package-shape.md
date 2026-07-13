# `package-shape`

> Every workspace is named `<scope>/<dir>`; library packages expose a barrel and point their build
> fields at the built output.

## Why

A monorepo stays navigable when a package's identity is mechanical: its npm name matches its folder,
and a library's public surface is a single barrel whose published entrypoints resolve to built output
rather than raw source. This makes "where does `@scope/foo` live?" and "what does it export?"
answerable without reading the file.

## What it flags

For each `package.json` matched by `libraryGlobs` (full checks) or `appGlobs` (name check only):

- **name** — must equal `<scope>/<dir-basename>` (or an `externalNames` override).
- **barrel** (library only) — the package must expose the configured `barrelPath`.
- **build fields** (library only) — each of `distFields` present as a string must contain
  `distMarker`, and `exports` must reference it.
- **invalid JSON** — reported as a violation.

App/surface packages are deployable entrypoints (vite/tauri/bun), so only the name check applies to
them.

## Factory

```ts
createPackageShapeRule(options?: PackageShapeOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | `string` | `'@nightcore'` | npm scope every workspace is named under. |
| `libraryGlobs` | `string[]` | `['packages/*/package.json']` | Library packages (full checks). |
| `appGlobs` | `string[]` | `['apps/*/package.json']` | App/surface packages (name check only). |
| `externalNames` | `Record<string,string>` | `{}` | Directory → exact name overrides for intentionally off-scope packages. |
| `barrelPath` | `string` | `'src/index.ts'` | Barrel each library must expose, relative to its dir. |
| `distMarker` | `string` | `'dist/'` | Substring the build-output fields must contain. |
| `distFields` | `string[]` | `['main','module','types']` | `package.json` string fields that must point at built output. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

De-projected from nightcore, which hardcoded the `@nightcore` scope, the `packages/*` vs `apps/*`
split, the `src/index.ts` barrel and the `dist/` marker.

## When not to use it

If your packages are not scope-named after their folders, or libraries publish raw source (no build
step), tune or disable the relevant checks via options.
