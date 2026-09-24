# `dockerfile-base-image-digest-pin`

> Dockerfile `FROM` base images are pinned by `@sha256:` digest.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createDockerfileBaseImageDigestPinRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

`FROM node:22-slim` names whatever the registry serves at build time, so two builds of one commit can
differ and a moved tag ships a change nobody reviewed. `tag@sha256:<digest>` keeps the tag for readers
and fixes the bytes.

## What it flags

Every `FROM` whose image has no `@sha256:` digest. Exempt: `FROM scratch` and `FROM <earlier stage>`.
An image chosen through a build arg (`FROM ${BASE}`) is resolved from its `ARG BASE=<default>` before
the first `FROM`; one that cannot be resolved is reported, since the text does not show what is
pulled. Each violation carries the 1-indexed line.

```dockerfile
# Bad
FROM node:22-slim AS deps

# Good
FROM node:22-slim@sha256:<digest> AS deps
FROM deps AS build
FROM scratch
```

## What it does not flag

- `FROM scratch` and `FROM <earlier stage>` (a name given by a previous `AS`).
- `FROM ${BASE}` whose `ARG BASE=<default>` before the first `FROM` is digest-pinned.
- Dockerfiles under any `skipDirs` segment (`node_modules`, `.git`, `dist`, `.turbo`, `coverage`) and
  files the `dockerfileGlobs` do not match.
- A `FROM` split with a line continuation (`\`): it is not read. Add a `Containerfile` glob if you use
  Podman naming.

## Options

```ts
createDockerfileBaseImageDigestPinRule(options?: DockerfileBaseImageDigestPinOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dockerfileGlobs` | `string[]` | `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` at any depth, dot-directories included | Dockerfiles to scan. |
| `skipDirs` | `string[]` | `['node_modules', '.git', 'dist', '.turbo', 'coverage']` | A path with any of these segments is skipped. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your images are built only for local development and you accept whatever a tag serves at build
time, skip it.
