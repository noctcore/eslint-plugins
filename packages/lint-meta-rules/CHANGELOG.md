# @noctcore/lint-meta-rules

## 0.2.0

### Minor Changes

- [`ce31932`](https://github.com/noctcore/eslint-plugins/commit/ce319327645396110d272864c7e09472cbfc06da) Thanks [@Shironex](https://github.com/Shironex)! - Add five CI-hygiene rule factories (category `ci`): `createGithubActionsShaPinnedRule`, `createGithubActionsRunnerPinnedRule`, `createServiceImageDigestPinRule`, `createDockerfileBaseImageDigestPinRule` and `createSecurityScannerVersionParityRule`. Each project-specific constant (workflow and Dockerfile/compose globs, skip dirs, the floating-label pattern, the unpinned-image exemption list, and the scanner name, variables and hook path) is a factory option with a default.

### Patch Changes

- [`d8c271a`](https://github.com/noctcore/eslint-plugins/commit/d8c271aa57b13361793356329f3361aaa2ef8b06) Thanks [@Shironex](https://github.com/Shironex)! - Bump the `@noctcore/harness` dependency range to `^0.2.0`. No consumed API changed (types and runtime exports used by this package — `IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline` — are unchanged between harness 0.1.0 and 0.2.0); this only widens the resolvable dependency range.

- [`7feaab7`](https://github.com/noctcore/eslint-plugins/commit/7feaab74f3fb393d6d1976640fa79478f7975fea) Thanks [@Shironex](https://github.com/Shironex)! - Require `@noctcore/harness` `^0.3.0`.

  This is a correctness bump, not housekeeping. Harness 0.3.0 fixes `ctx.glob`, which
  under Bun returned an empty list for any dot-directory segment, including a fully
  literal `.github/workflows/ci.yml`. Four of this package's CI-hygiene rules glob
  exactly that path by default, so on harness 0.2.0 under Bun they reported nothing at
  all, and `security-scanner-version-parity` reported a false violation while hiding a
  real scanner drift.

  A caret range on a `0.x` version never crosses the minor, so `^0.2.0` could not pick
  the fix up on its own.
