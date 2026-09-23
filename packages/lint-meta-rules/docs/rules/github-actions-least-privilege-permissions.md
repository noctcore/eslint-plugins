# `github-actions-least-privilege-permissions`

> A workflow's top-level `permissions:` exists, is not `write-all` / `read-all`, and grants no write.

## Why

The top-level `permissions:` is the `GITHUB_TOKEN` every job gets unless the job says otherwise. A
write there hands every job, and every third-party action any job runs, the power to push commits,
cut releases or edit issues. Leaving the block out is worse: the token then falls back to the
repository's default, which is read-write on many repositories and organisations. A compromised
action or an injected script can only do what the token allows, so the smallest token is the
cheapest containment there is.

Keep the top level read-only and grant each write on the job that needs it.

## What it flags

- A workflow with no top-level `permissions:`, naming each job that has no job-level
  `permissions:` either and so runs on the default token. Reported on line 1.
- `permissions: write-all` and `permissions: read-all` at the top level: every scope, including
  ones the workflow never uses.
- Every `<scope>: write` in the top-level block (block or flow mapping), one violation per scope, on
  its own line, unless the scope is in `allowTopLevelWrite`.

```yaml
# Bad
permissions: write-all

permissions:
  contents: write
  id-token: write

# Good
permissions:
  contents: read
jobs:
  release:
    permissions:
      contents: write
      id-token: write
```

## What it leaves alone

- A workflow with no top-level block when every job declares its own `permissions:`: the default
  token then reaches no job.
- `permissions: {}`, and any scope at `read` or `none`.
- Writes on a job, a `permissions:` input under a step's `with:`, and a commented-out line.

## Factory

```ts
createGithubActionsLeastPrivilegePermissionsRule(options?: GithubActionsLeastPrivilegePermissionsOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `allowTopLevelWrite` | `string[]` | `[]` | Scopes allowed at `write` in the top-level block, for a repo that accepts, say, `contents: write` on a single-job release workflow. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Limits

Line-based text, not a YAML parse. It checks the top level only; a job that grants itself more than
it uses is not judged. A reusable workflow (`on: workflow_call`) is held to the same bar, although
its token can never exceed its caller's.

Prior art: zizmor's [`excessive-permissions`](https://docs.zizmor.sh/audits/#excessive-permissions)
audit and the OpenSSF Scorecard
[Token-Permissions](https://github.com/ossf/scorecard/blob/main/docs/checks.md#token-permissions)
check.
