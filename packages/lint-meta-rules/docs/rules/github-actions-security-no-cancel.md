# `github-actions-security-no-cancel`

> A security scan workflow never sets a literal `cancel-in-progress: true`, so a newer run cannot cancel a scan halfway.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsSecurityNoCancelRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A scan that a newer push cancels part way leaves the earlier commit with no finished result. When the
scan is a required check or the only gate on a branch, that commit can merge without ever having been
scanned in full. Cancelling is right for a build or a test run, whose result a newer run replaces, and
wrong for a scan whose whole point is to finish on every commit.

## What it flags

A `cancel-in-progress` set to a literal true (`true`, `True` or `TRUE`, quoted or not) in a
`concurrency` mapping, at workflow level or at job level, written as a block or as a flow mapping. Only
workflows whose file base name matches `securityWorkflowPattern` are read. The violation points at the
`cancel-in-progress` line of a block, and at the `concurrency:` line of a flow mapping.

```yaml
# Bad
concurrency:
  group: sast-${{ github.ref }}
  cancel-in-progress: true

jobs:
  scan:
    concurrency: { group: scan, cancel-in-progress: true }

# Good
concurrency:
  group: sast-${{ github.ref }}
  cancel-in-progress: false
```

## What it does not flag

- An expression value, such as `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. It
  cannot be resolved from the text, so it is a known limit.
- The string form, `concurrency: ${{ github.workflow }}`, which sets no `cancel-in-progress`.
- `cancel-in-progress: true` text that is not a direct child of a `concurrency` key, for example inside
  a `run: |` script, and a line that is commented out.
- A workflow whose base name does not match the pattern (`ci.yml`, `build.yml`). Only the base name
  counts, never the directory.

Line-based text, not a YAML parse. A flow mapping that wraps over several lines is not read.

## Options

```ts
createGithubActionsSecurityNoCancelRule(options?: GithubActionsSecurityNoCancelOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `securityWorkflowPattern` | `RegExp` | `/security\|sast\|secrets\|codeql\|scan/iu` | A workflow whose file base name matches is a security scan workflow. A `g` or `y` flag is ignored. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your scans run on a schedule only, or a newer scan always supersedes the older one on purpose, a
cancelled run costs nothing and this adds nothing.

## Related

- [`github-actions-timeout-required`](./github-actions-timeout-required.md) bounds how long a hung
  scan can hold its runner.
