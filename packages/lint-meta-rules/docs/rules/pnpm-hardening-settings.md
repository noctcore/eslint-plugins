# `pnpm-hardening-settings`

> pnpm's install-time hardening stays switched on in `pnpm-workspace.yaml`, and nothing overrides it.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createPnpmHardeningSettingsRule` from `@noctcore/lint-meta-rules` · Category `supply-chain` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

pnpm can refuse an install that runs an unapproved build script, pulls a dependency from a git URL,
ignores `engines`, or takes a package whose provenance got weaker than its last release. Each of
these is one line in `pnpm-workspace.yaml`, and each is a line a frustrated install can flip back:
the install then simply works again, and nobody notices that the check is gone. The same goes for an
override at the command line, which switches a setting off for one run without touching the file.

## What it flags

In `pnpm-workspace.yaml`:

- a `required` setting with another value or missing (missing counts as off). Default:
  `strictDepBuilds: true`, `blockExoticSubdeps: true`, `engineStrict: true`,
  `trustPolicy: no-downgrade`;
- `minimumReleaseAge` missing, not a number, or below the floor (default 10080 minutes, seven days);
- a `minimumReleaseAgeExclude` other than exactly the configured list (default: none);
- a `trustPolicyExclude` entry that is not an exact version (`name@1.2.3` or `name@1.2.3 || 4.5.6`),
  or whose comment block above it does not name the package and every version. An exact entry makes
  the next release be judged again; the comment is the review;
- a `forbidden` setting set at all. Default `trustPolicyIgnoreAfter` and
  `dangerouslyAllowAllBuilds`: each switches a check off for every package at once.

Elsewhere: any of those settings in `.npmrc` or the root `package.json` `pnpm` block (it would win
over the workspace file or split the answer in two), and a command-line override
(`--config.<key>`, `--[no-]<key>`, `npm_config_<key>` / `pnpm_config_<key>` in any case) in a
workflow, a Dockerfile or a manifest script.

```yaml
# pnpm-workspace.yaml: reported twice
strictDepBuilds: false
trustPolicyExclude:
  - 'semver@^7.0.0'
```

## What it does not flag

- A repo with no `pnpm-workspace.yaml`: another installer has nothing here to check.
- Settings it does not govern, and a governed setting at the expected value.

Line-based text, not a YAML parse: a flow list written on the key's own line is reported as
unreadable rather than guessed at.

## Options

```ts
createPnpmHardeningSettingsRule(options?: PnpmHardeningSettingsOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `required` | `Record<string, string>` | the four settings above | Settings that must hold this exact value. |
| `minimumReleaseAgeMinutes` | `number` | `10080` | Smallest `minimumReleaseAge` allowed. `0` skips the check. |
| `releaseAgeExclude` | `string[]` | `[]` | The exact `minimumReleaseAgeExclude` list, for example your own scope (`['@acme/*']`) if your packages must install the day they ship. |
| `forbidden` | `string[]` | `['trustPolicyIgnoreAfter', 'dangerouslyAllowAllBuilds']` | Settings that must not be set. |
| `checkTrustPolicyExclude` | `boolean` | `true` | Check every `trustPolicyExclude` entry is exact and reasoned. |
| `workflowGlobs` | `string[]` | `.github/workflows/*.y(a)ml` | Workflows scanned for an override. |
| `dockerfileGlobs` | `string[]` | `Dockerfile`, `Dockerfile.*`, `*.Dockerfile` at any depth | Dockerfiles scanned for an override. |
| `manifestGlobs` | `string[]` | root, `apps/*`, `packages/*`, `tools/*` | Manifests whose scripts are scanned for an override. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

The defaults need pnpm 10 or newer, where these settings exist.

## When not to use it

If you do not use pnpm, or install on a pnpm version without these settings, skip it.
