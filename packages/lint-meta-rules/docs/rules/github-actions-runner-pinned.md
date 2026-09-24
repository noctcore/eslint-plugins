# `github-actions-runner-pinned`

> Workflow jobs run on a named runner image, never a `*-latest` label.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsRunnerPinnedRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

GitHub repoints `ubuntu-latest` (and `macos-latest`, `windows-latest`) to a new OS image on its own
schedule, so a green workflow can turn red, or quietly change what it tests, with no commit in your
repo. Pinning a named image makes the move a reviewed diff.

## What it flags

Every floating label in a `runs-on:` value, read as a scalar, a flow list (`[a, b]`), a block list, or
a `group:` / `labels:` mapping.

```yaml
# Bad
runs-on: ubuntu-latest
runs-on: [self-hosted, ubuntu-latest]

# Good
runs-on: ubuntu-24.04
runs-on: ${{ matrix.os }}
```

## What it does not flag

- A named image (`ubuntu-24.04`), quoted or with a trailing comment, and a custom label such as
  `self-hosted`.
- An expression (`${{ matrix.os }}`): it cannot be judged from the text.
- A commented-out `runs-on:`, and a later key in the job (`name: ubuntu-latest`) after the label list.

Line-based text, not a YAML parse. A matrix value such as `os: [ubuntu-latest]` that feeds
`runs-on: ${{ matrix.os }}` is not checked.

## Options

```ts
createGithubActionsRunnerPinnedRule(options?: GithubActionsRunnerPinnedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `floatingLabel` | `RegExp` | `/^[\w.-]+-latest$/u` | A label matching this is floating. Do not pass a `g`-flagged regex. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If you want your CI to track GitHub's newest runner images automatically and accept the unreviewed
moves, skip it.
