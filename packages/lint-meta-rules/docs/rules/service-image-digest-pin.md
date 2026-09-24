# `service-image-digest-pin`

> Workflow service/container images and docker-compose images are pinned by `@sha256:` digest.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createServiceImageDigestPinRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A tag (`postgres:17-alpine`) or `latest` names whatever the registry serves today, so a green build
can change under an unchanged commit, and a local run cannot promise the bytes CI ran.
`tag@sha256:<digest>` keeps the readable tag and fixes the content.

## What it flags

- In workflow files: `image:` under a job's `services:`, and a job's `container:` in scalar or mapping
  form.
- In compose files: every service's `image:`, including one behind an env default
  (`${REDIS_IMAGE:-redis:7}`), which is reported as written since the text does not show a digest.

Each violation carries the 1-indexed line.

```yaml
# Bad
services:
  db:
    image: postgres:17-alpine

# Good
services:
  db:
    image: postgres:17-alpine@sha256:<digest>
  api:
    build: .
    image: app-api:local
```

## What it does not flag

- An image pinned as `tag@sha256:<digest>`.
- An action step's `with: image:` input: it is not an image pull.
- A compose service that also has `build:`: there `image:` tags an image built locally, which has no
  upstream digest.
- An exact ref listed in `allowUnpinned`, and compose files under a `skipDirs` segment.

The check is line-based text, not a YAML parse.

## Options

```ts
createServiceImageDigestPinRule(options?: ServiceImageDigestPinOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `composeGlobs` | `string[]` | `compose` / `docker-compose` with optional `.x` / `-x` infix, `.yml` / `.yaml`, at any depth including dot-directories | Compose files to scan. |
| `skipDirs` | `string[]` | `['node_modules', '.git', 'dist', '.turbo', 'coverage']` | A compose path with any of these segments is skipped. |
| `allowUnpinned` | `string[]` | `[]` | Exact image refs allowed unpinned, for a ref the registry cannot serve a digest for. Only that exact ref passes; a bumped tag is checked again. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your workflows and compose files only run throwaway local services where you accept whatever a tag
serves today, skip it.
