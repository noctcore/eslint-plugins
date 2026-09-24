# `github-actions-sha-pinned`

> GitHub Actions `uses:` refs are pinned to a 40-character commit SHA with a `# vN` comment.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsShaPinnedRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

A tag or branch ref is a moving target: whoever controls the action's repository can repoint it, and
the new code runs with your workflow's token. A full commit SHA cannot move. The trailing `# vN`
comment keeps the pin readable and is what Dependabot rewrites on a bump, so a bare SHA is rejected
too.

## What it flags

Every `uses:` line (step-level and job-level reusable workflow calls) in the scanned workflow files:

- a ref whose pin is not a 40-character hex SHA (tags, branches, short SHAs, no `@` at all),
- a SHA-pinned ref with no `# vN` comment,
- a `docker://` ref with no `@sha256:<digest>`.

Local actions (`uses: ./path`) are exempt. Each violation carries the 1-indexed line.

```yaml
# Bad
- uses: actions/checkout@v6
- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803

# Good
- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
- uses: ./.github/actions/setup
```

## Factory

```ts
createGithubActionsShaPinnedRule(options?: GithubActionsShaPinnedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Limits

The check is line-based text, not a YAML parse. A `uses:` value split across lines, or built from an
expression, is not seen.
