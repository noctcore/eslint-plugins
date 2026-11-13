# `github-actions-self-hosted-fork-guard`

> A workflow triggered by `pull_request` does not run on a self-hosted runner unless `runs-on` carries a fork guard.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsSelfHostedForkGuardRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A pull request from a fork runs the fork's workflow code. On a GitHub-hosted runner that code lands in a
throwaway VM; on a self-hosted runner it lands on a machine you own, with whatever network and files that
machine can reach. A guard inside `runs-on` sends fork pull requests to a hosted runner and keeps your own
branches on the self-hosted one.

## What it flags

A `runs-on:` in a workflow whose `on:` selects `pull_request` (a scalar, a flow list, a mapping key or a
block list item) when the value selects the `self-hosted` label, or an expression listed in
`selfHostedExpressions`, and does not contain the fork guard. The label is read from a scalar, a flow list,
a block list, a `labels:` mapping, and from a quoted literal inside an expression.

```yaml
# Bad
on: pull_request
jobs:
  build:
    runs-on: self-hosted

# Good
on: pull_request
jobs:
  build:
    runs-on: ${{ !github.event.pull_request.head.repo.fork && 'self-hosted' || 'ubuntu-24.04' }}
```

## What it does not flag

- A workflow with no `pull_request` trigger. `pull_request_target` is a different trigger and is not read.
- A GitHub-hosted label (`ubuntu-24.04`), a custom label such as `my-self-hosted-pool`, and an expression
  such as `${{ matrix.os }}` that is not listed in `selfHostedExpressions`.
- A `runs-on` that contains the guard, whatever whitespace sits inside or around it.
- A commented-out `runs-on:`.

The guard counts only inside `runs-on`: a job-level `if:` with the same condition does not satisfy the rule.
The check is line-based text, not a YAML parse.

## Options

```ts
createGithubActionsSelfHostedForkGuardRule(options?: GithubActionsSelfHostedForkGuardOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `selfHostedExpressions` | `string[]` | `[]` | `runs-on` expressions, such as `vars.CI_RUNNER`, that resolve to a self-hosted runner. Each entry matches as a substring, ignoring whitespace; empty entries are ignored. |
| `forkGuard` | `string` | `'!github.event.pull_request.head.repo.fork'` | Text that must appear inside `runs-on`, ignoring whitespace. A custom value replaces the default, so the default guard no longer satisfies the rule. An empty value is never present, so every self-hosted `runs-on` is reported. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your self-hosted runners are ephemeral and isolated from anything sensitive, or the repository accepts
no pull requests from forks, skip it.
