# `github-actions-concurrency-explicit`

> A workflow-level or job-level `concurrency` mapping must state `cancel-in-progress`, so the choice to cancel a running job is written down.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsConcurrencyExplicitRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

When a `concurrency` mapping leaves out `cancel-in-progress`, GitHub does not cancel the running job
when a newer one enters the group. That is a decision, and one a reader of the file cannot tell from
a forgotten key. Writing `cancel-in-progress: true` or `false` shows the choice was made, and it
stops a copied block from carrying the default into a workflow where cancelling is wrong (or right).

## What it flags

A `concurrency` key at workflow level, or directly under a job, whose mapping has no
`cancel-in-progress` entry. Both block and flow mappings are read, and an empty `concurrency:` or
`concurrency: {}` counts as a mapping without the key. The violation points at the `concurrency:`
line. A job that calls a reusable workflow (`uses:` on the job) is checked like any other job.

With `requireMappingForm: true` the string form is reported too, at both levels, because it cannot
carry `cancel-in-progress`.

```yaml
# Bad
concurrency:
  group: ci-${{ github.ref }}

jobs:
  build:
    concurrency: { group: build }

# Good
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    concurrency: { group: build, cancel-in-progress: false }
```

## What it does not flag

- The string form, `concurrency: ${{ github.workflow }}-${{ github.ref }}`, unless `requireMappingForm`
  is set.
- `cancel-in-progress` with any value, including `false`, a quoted value and a `${{ }}` expression.
- A `concurrency` key nested deeper than a job's own keys, for example under `with:` or `env:`, or
  inside a `run: |` script, and a line that is commented out.
- A flow mapping that wraps over several lines. It is not read, so the rule stays quiet on it.

Line-based text, not a YAML parse. A block mapping whose key is quoted (`"cancel-in-progress":`) is not
recognised and is reported.

## Options

```ts
createGithubActionsConcurrencyExplicitRule(options?: GithubActionsConcurrencyExplicitOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `requireMappingForm` | `boolean` | `false` | Also report the string form of `concurrency`, which cannot state `cancel-in-progress`. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your workflows rely on GitHub's default on purpose and a missing key reads fine to your team, this
asks for a line that changes nothing.

## Related

- [`github-actions-security-no-cancel`](./github-actions-security-no-cancel.md) checks the value of the
  same key in security scan workflows.
