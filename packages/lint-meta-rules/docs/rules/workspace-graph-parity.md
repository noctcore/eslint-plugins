# `workspace-graph-parity`

> Imported `<scope>/*` specifiers must be declared `workspace:*` deps, and tsconfig `references` must
> mirror those deps.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createWorkspaceGraphParityRule` from `@noctcore/lint-meta-rules` · Category `config` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A cross-package edge is real in three places at once: the import in source, the `workspace:*` entry in
`package.json`, and the project reference in `tsconfig.json`. When they drift, a package builds
locally but breaks on a clean install or a project-graph build. This rule keeps the three in lockstep
so an edge can never be half-wired.

## What it flags

For each workspace `package.json`:

- **(a) imported ⊆ declared** — every `<scope>/<pkg>` imported under the source dir must appear as a
  `"<scope>/<pkg>": "workspace:*"` dependency.
- **(b) references mirror deps** — the tsconfig `references` must reference exactly the declared
  workspace deps: a declared dep missing from references, or a referenced package that is not a
  declared dep, is a violation.

## What it does not flag

- A package importing itself by its own `<scope>/<dir>` name.
- Imports in test files (`.test.ts`, `.test.tsx`) and files outside `srcDir`.
- Imports without a `from` clause (`import()`, `require()`, a side-effect `import`): only
  `from '<scope>/<pkg>'` is read.
- Check (b) for a package with no `tsconfig.json`.

## Options

```ts
createWorkspaceGraphParityRule(options?: WorkspaceGraphParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scope` | `string` | `'@nightcore'` | npm scope of workspace packages (all scope regexes are rebuilt from it). |
| `packageGlobs` | `string[]` | `['packages/*/package.json', 'apps/*/package.json']` | Packages to enforce parity for. |
| `srcDir` | `string` | `'src'` | Source directory (per package) scanned for imports. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your project does not use the `workspace:*` protocol, or does not use TypeScript project
references, this rule's assumptions do not hold.
