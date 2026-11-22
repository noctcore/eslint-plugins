# `github-actions-package-cache`

> A job that installs with npm, pnpm or yarn must set the matching `cache:` on its `actions/setup-node` step, and a job that runs `bun install` must have an `actions/cache` step.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsPackageCacheRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

An install without a restored cache downloads the whole dependency tree on every run. That is tens of
seconds per job, multiplied by every job, every workflow and every push, and it makes each run depend
on the registry being fast and reachable. `actions/setup-node` restores the npm, pnpm or yarn store
only when its `cache:` input names the manager, and the Bun setup action caches the bun binary, not
the install cache, so a Bun job needs its own `actions/cache` step.

### Opt-in

The rule is in `RULE_FACTORIES` and in `OPT_IN_RULE_IDS`, so a bare `createAllRules()` skips it and
adding it gives no existing caller a new violation. Code that iterates `RULE_FACTORIES` or `RULE_IDS`
itself does build it, at `ciCritical: true`: filter out `OPT_IN_RULE_IDS` there if you do not want it.
Enable it by naming it in `optIn`, or by calling its factory:

```ts prose
import { createAllRules, createGithubActionsPackageCacheRule } from '@noctcore/lint-meta-rules';

const everything = createAllRules({ optIn: ['github-actions-package-cache'] });
const justThisOne = createGithubActionsPackageCacheRule({ managers: ['pnpm'] });
```

## What it flags

Per job, line based like the other workflow rules:

- a job that installs with npm, pnpm or yarn where no `actions/setup-node` step sets a `cache:`
  (or every one is empty), reported at the first setup step;
- the same with a `cache:` that names a different manager (`cache: npm` in a job that runs
  `pnpm install`), reported at the first setup step. A job with several setup steps passes when
  any one of them caches the manager it installs with;
- a job that runs `bun install` with no cache step, reported at the install step.

An install is `npm ci`, `npm install` / `npm i`, `pnpm install` / `pnpm i`, `yarn install` or a bare
`yarn`, and `bun install` / `bun i`, at the start of a `run:` line or after `&&`, `||`, `;`, `|` or
`(`. A job that installs with two managers gets one violation per manager.

The `with:` inputs are read as a block (`cache: pnpm` on its own line) or as a flow mapping on one
line (`with: { node-version: 22, cache: pnpm }`). Lines may end in CRLF.

```yaml
# Bad
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: pnpm install --frozen-lockfile

# Good
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
```

```yaml
# Bad
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile

# Good
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: oven-sh/setup-bun@v2
      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
      - run: bun install --frozen-lockfile
```

## What it does not flag

- A job with an `actions/cache` or `actions/cache/restore` step (`cacheActions`), for any manager.
- A `cache:` written as an expression (`cache: ${{ matrix.pm }}`): the rule cannot tell what it
  resolves to.
- npm with no `cache:` when the root `package.json` names npm in `packageManager` or
  `devEngines.packageManager` and the step does not set `package-manager-cache: false`: setup-node
  turns the npm cache on by itself there. v5 did this for any `packageManager`; v6 and later do it
  for npm only, which is the behaviour the rule assumes.
- A setup step whose `with:` is a flow mapping wrapped over several lines: the rule does not parse
  it, so it skips the step rather than report it.
- A job that installs with npm, pnpm or yarn but has no `actions/setup-node` step (Node from the
  runner image, or set up some other way): there is no `cache:` input to check.
- Commands that fetch no project tree: a global install (`-g`, `--global`), `bun install
  --lockfile-only`, `--version` and `--help`, and other subcommands such as `pnpm run build`.
- An install inside a composite action or a reusable workflow, which the rule does not open.

## Options

```ts
createGithubActionsPackageCacheRule(options?: GithubActionsPackageCacheOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `managers` | `('npm' \| 'pnpm' \| 'yarn' \| 'bun')[]` | `['npm', 'pnpm', 'yarn', 'bun']` | The managers whose installs are checked. |
| `setupActions` | `string[]` | `['actions/setup-node']` | Setup actions whose `cache:` input caches npm, pnpm or yarn, matched on the name before `@`, case-insensitively. |
| `cacheActions` | `string[]` | `['actions/cache', 'actions/cache/restore']` | Steps that count as a cache for any manager, matched the same way. |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

The rule checks that a cache is restored, not that it is keyed well: an `actions/cache` step with a
`path` that is not the manager's store passes. The automatic npm cache is assumed for setup-node at
any version, while it only exists from v5, and the rule follows v6 and later: under v5, which also
cached pnpm and yarn by itself, a pnpm or yarn job with no `cache:` is reported though it is cached. A workflow whose jobs run on self-hosted runners that keep
the store between runs does not need the cache: leave the rule off, or narrow `workflowGlobs`.

## Related

- [`node-version-parity`](./node-version-parity.md) reads the same `actions/setup-node` steps for the
  Node version they install.
