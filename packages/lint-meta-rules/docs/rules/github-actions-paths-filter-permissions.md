# `github-actions-paths-filter-permissions`

> A job that runs a paths-filter action must have an effective `pull-requests: read` grant, resolved per job.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsPathsFilterPermissionsRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A paths-filter action reads the changed files of a pull request through the pull request files API. On a
private repository, or wherever the default token is restricted, a token without `pull-requests: read`
fails that call and the job dies with "Resource not accessible by integration". The trap is a
job-level `permissions:` block: it replaces the workflow-level block entirely, so a job that adds
`contents: read` for itself silently drops the `pull-requests: read` the workflow granted. Checking the
grant per job catches that before the first pull request run.

## What it flags

A job with a step whose `uses:` names a filter action (`filterActions`, default `dorny/paths-filter`)
when the job's effective `permissions:` does not grant `pull-requests` at `read` or `write`. The
effective block is the job's own when it has one, else the workflow's, else none. One violation is
reported per job, at the first filter step, and the message says why:

- a job-level block that replaces a workflow-level block which did grant `pull-requests`;
- `pull-requests: none`, an empty `permissions: {}`, or a mapping that does not list the scope;
- no `permissions:` at either level, so the job gets the repository default token, which on a
  restricted default (typical for private repositories) lacks `pull-requests`.

```yaml
# Bad
permissions:
  contents: read
  pull-requests: read

jobs:
  changes:
    permissions:
      contents: read
    runs-on: ubuntu-24.04
    steps:
      - uses: dorny/paths-filter@v3

# Good
permissions:
  contents: read

jobs:
  changes:
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-24.04
    steps:
      - uses: dorny/paths-filter@v3
```

The `uses:` value is matched on the action name before `@`, case-insensitively, so SHA-pinned and
tag-pinned references match the same way, and `dorny/paths-filter-extra` is a different action.

## What it does not flag

- A job whose effective grant has `pull-requests: read` or `pull-requests: write`, whether it comes
  from the job or from the workflow, in block or single-line flow form.
- `read-all` and `write-all`, at either level.
- A job that runs no filter action.
- A `permissions:` value the reader does not parse: a flow mapping wrapped over several lines, or any
  other scalar such as an expression. It stays quiet on those.

## Options

```ts
createGithubActionsPathsFilterPermissionsRule(options?: GithubActionsPathsFilterPermissionsOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filterActions` | `string[]` | `['dorny/paths-filter']` | Actions that call the pull request files API, matched on the name before `@`, case-insensitively. |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

The rule reads permissions only, not triggers. A workflow that runs a filter action on `push` alone
does not call the pull request files API, so the grant is not needed there: disable the rule for that
workflow glob. A filter action that runs inside a composite action, or inside a reusable workflow
called by a job-level `uses:`, is not seen.

## Related

- [`github-actions-least-privilege-permissions`](./github-actions-least-privilege-permissions.md) checks
  that a workflow does not grant more than it needs; this rule checks that a filter job gets enough.
