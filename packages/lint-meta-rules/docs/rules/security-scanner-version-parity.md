# `security-scanner-version-parity`

> CI and the local pre-push hook pin the same secret-scanner version, and the hook checks it at run
> time.

## Why

Different scanner versions ship different rulesets, so a push can pass the local hook and fail CI (or
the reverse) with no code difference. Pinning one version on both sides, and having the hook refuse a
native binary of another version, keeps the two scans the same scan.

## What it flags

With the defaults (gitleaks):

- workflows that pin different `GITLEAKS_VERSION` values,
- a hook that runs gitleaks when no workflow pins `GITLEAKS_VERSION`, or workflows that pin it when the
  hook never runs gitleaks,
- a hook with no `GITLEAKS_VERSION="x.y.z"` declaration, or one that differs from CI,
- a hook `GITLEAKS_IMAGE="...gitleaks:vX.Y.Z"` tag that differs from CI,
- a hook that never runs `gitleaks version`.

Dormant when neither the workflows nor the hook mention the scanner.

```yaml
# .github/workflows/security.yml
env:
  GITLEAKS_VERSION: '8.30.1'
```

```bash
# Good: scripts/ci/pre-push.sh
GITLEAKS_VERSION="8.30.1"
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v${GITLEAKS_VERSION}"
[ "$(gitleaks version)" = "$GITLEAKS_VERSION" ] || exit 1

# Bad: a drifted pin and no run-time check
GITLEAKS_VERSION="8.29.0"
gitleaks git .
```

## Factory

```ts
createSecurityScannerVersionParityRule(options?: SecurityScannerVersionParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scanner` | `string` | `'gitleaks'` | The scanner's binary name, as it appears in the hook and its image name. |
| `versionVariable` | `string` | `'GITLEAKS_VERSION'` | The variable both sides pin the version in (`KEY: x.y.z` in workflows, `KEY=x.y.z` in the hook). |
| `imageVariable` | `string` | `'GITLEAKS_IMAGE'` | The hook's optional image variable, whose `<scanner>:vX.Y.Z` tag must agree. |
| `hookFile` | `string` | `'scripts/ci/pre-push.sh'` | The local hook script, repo-relative. |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Limits

It checks that the hook's text runs `<scanner> version`, not that the comparison is correct, and it
reads only `x.y.z` versions. One hook file is checked; a repo with several hooks needs one rule
instance per hook.
