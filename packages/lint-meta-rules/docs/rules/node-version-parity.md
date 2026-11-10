# `node-version-parity`

> `.nvmrc`, `engines.node`, every `setup-node` step and every Docker node image agree on the Node major.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createNodeVersionParityRule` from `@noctcore/lint-meta-rules` · Category `supply-chain` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

Four places pick a Node version: developers' machines read `.nvmrc`, the installer refuses a Node
below the root `engines.node`, CI installs whatever `actions/setup-node` is told, and images build
on a `node` base. When they drift, a dependency whose `engines` excludes one of those Nodes fails in
that one place only, usually CI or the image build, far from the commit that caused it.

## What it flags

With a version file present (default `.nvmrc`):

- a version file that is not a version (`22`, `22.23.2` and `v22.23.2` are);
- a root `engines.node` that is missing, is not a single `>=X.Y.Z` floor, starts on another major,
  or sits above the version file (the installer would refuse it);
- a `setup-node` step that reads another version file, names no version at all (it installs
  whatever the runner image has), or writes a `node-version` on another major (setup-node installs
  that one even with a version file beside it);
- a Dockerfile `FROM` of a node image, from any registry or mirror, on another major or whose tag
  names no major (`lts`, `latest`, a bare digest); a `FROM` that hides the major behind a variable
  that mentions node (`node:${NODE_VERSION}-slim`, `${NODE_IMAGE}`); and an `ARG` or `ENV NODE_MAJOR`
  on another major.

```yaml
# .nvmrc says 22; reported
- uses: actions/setup-node@v6
  with:
    node-version: 20
```

```dockerfile
# Reported: no major in the tag
FROM node:lts-slim
```

## What it does not flag

- A repo with no version file: it has not chosen this convention.
- A `node-version` from an expression (`${{ matrix.node }}`): a matrix legitimately tests several.
- A variable base that does not mention node (`FROM ${BASE}`): it may be any image.
- The minor of an image: images are usually pinned by digest, which hides the minor it resolves to.

Line-based text, not a YAML or Dockerfile parse.

## Options

```ts
createNodeVersionParityRule(options?: NodeVersionParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `versionFile` | `string` | `'.nvmrc'` | The file every other place is compared with (`.node-version` works the same way). |
| `checkEngines` | `boolean` | `true` | Check the root `package.json` `engines.node` floor. |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflows scanned for `actions/setup-node`. |
| `dockerfileGlobs` | `string[]` | `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` at any depth | Dockerfiles scanned for a node base image. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If you deliberately run different Node majors in different places (a library tested on several,
with no version file as the source of truth), skip it.
