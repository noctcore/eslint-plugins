# `github-actions-timeout-required`

> Every GitHub Actions job that runs steps declares a job-level `timeout-minutes`.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsTimeoutRequiredRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A job with no `timeout-minutes` runs for GitHub's default of six hours. A test that waits on a port
nobody opens, an install stuck on a registry, or a prompt nobody answers then holds the pull request
check and a runner for the whole six hours, and on a private repo burns that many Actions minutes.
A job-level timeout a little above the job's slowest green run turns the hang into a fast, readable
failure.

## What it flags

Every job under `jobs:` in each workflow file without a job-level `timeout-minutes`, or with one
that is not a positive number of minutes. The message names the job and its line.

```yaml
# .github/workflows/ci.yml: reported
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - run: pnpm test
```

```yaml
# passes
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - run: pnpm test
```

A `timeout-minutes` on a step, or on a service container, does not count: it bounds that step, not
the job.

## What it does not flag

- A reusable-workflow call (`uses:` on the job): it cannot set `timeout-minutes`; the called
  workflow's own jobs carry it.
- A timeout written as an expression (`${{ inputs.minutes }}`), which GitHub resolves at run time.
- A workflow file with no `jobs:` block.

## Options

```ts
createGithubActionsTimeoutRequiredRule(options?: GithubActionsTimeoutRequiredOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

The workflow is read line by line with its own indentation, so two-space and four-space files both
work; flow-style YAML (`jobs: { build: { ... } }`) is not read.

## When not to use it

If you run no GitHub Actions, or every job already goes through a reusable workflow that sets its
own timeouts, there is nothing for it to check.
