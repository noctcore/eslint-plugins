# `github-actions-pip-install-pinned`

> Every package a workflow `run:` step installs with `pip`, `uv pip` or `pipx` is pinned to an exact version with `==`.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsPipInstallPinnedRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: no
<!-- end generated rule header -->

## Why

An unpinned `pip install semgrep` installs whatever release is newest on the day CI runs. A green
workflow can turn red, or quietly run different code, with no commit in your repository, and a release
that was published an hour ago reaches your pipeline before anyone has reviewed it. An exact `==` pin
makes the move a diff you read.

The rule prints its findings and fails CI only with `ciCritical: true`. Until you opt in, a finding shows
as an `[info]` line and the run still passes.

## What it flags

Each bare package token of an install in a `run:` value, at its own line, whether the `run:` is inline or
a `|` or `>` block. The installers it reads are `pip`, `pip3`, `python -m pip`, `python3 -m pip`,
`uv pip` and `pipx install`, at the start of a command (after `sudo` or `NAME=value` words). A line that
ends in `\` continues the command, and a command stops at `&&`, `||`, `;` and `|`, so the arguments of a
following command are never read as packages.

A `>=` or `~=` range is flagged too, with a message that names the operator and asks for `==`. Any other
operator (`!=`, `<`, `>`, `<=`) is reported as having no pin. `pip install --upgrade pip` is flagged:
`pip` is a bare package.

```yaml
# Bad
steps:
  - run: pip install yamllint semgrep
  - run: |
      pip install \
        "httpx>=0.27" \
        "uvicorn[standard]"

# Good
steps:
  - run: pip install yamllint==1.35.1 semgrep==${SEMGREP_VERSION}
  - run: |
      pip install \
        "httpx==0.27.2" \
        "uvicorn[standard]==0.30.0"
```

## What it does not flag

- Flags (`--upgrade`, `--no-cache-dir`) and the value of a flag that takes one: `-r`, `--requirement`,
  `-c`, `--constraint`, `-e`, `--editable`, `-i`, `--index-url`, `--extra-index-url`, `-f`,
  `--find-links`, `-t`, `--target`, `--python`, `--prefix`, `--root`, `--src`, `--platform`,
  `--python-version`, `--implementation`, `--abi`, `--no-binary`, `--only-binary` and a few more. An
  `--option=value` form consumes nothing.
- Tokens that contain `/` (a path or a URL), `.txt`, `.whl`, `.tar.gz` and `.zip` arguments, `.` and
  `-e .`.
- A token that is a shell variable, a command substitution or a `${{ }}` expression, since its value
  cannot be judged from the text. `pkg==${VERSION}` is pinned.
- `pkg[extra]==1.0`, which is pinned. A `==` pin with a wildcard (`pkg==1.*`) also counts.
- A commented-out line and `pip install` text outside a `run:` value, such as a step `name:`.
- Everything after a redirection (`2>&1`, `> log`) in a command.

Line-based text, not a YAML parse or a shell parse. Known limits: a quoted requirement with spaces
(`"pkg == 1.0"`), a folded `>` block that wraps one command over lines without `\`, a `pkg @ url`
reference, an installer called by path such as `.venv/bin/pip`, and composite `action.yml` files unless
you add them to `workflowGlobs`.

## Options

```ts
createGithubActionsPipInstallPinnedRule(options?: GithubActionsPipInstallPinnedOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `installers` | `string[]` | `['pip', 'pip3', 'python -m pip', 'python3 -m pip', 'uv pip', 'pipx']` | Command prefixes that start an install, written without the trailing `install` (`'pipx install'` and `'pipx'` mean the same). Passing the option replaces the whole default list. |
| `ciCritical` | `boolean` | `false` | Whether a violation fails CI. The rule reports without failing until you set `true`. |

## When not to use it

If a lockfile or a hash-pinned requirements file already controls every install (`pip install -r
requirements.txt` with `--require-hashes`), the inline installs this rule reads are rare and a pin adds
little.

## Related

- [`github-actions-sha-pinned`](./github-actions-sha-pinned.md) pins the actions a workflow uses, the
  same way this rule pins the packages a step installs.
