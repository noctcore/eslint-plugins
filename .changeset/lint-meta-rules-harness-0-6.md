---
'@noctcore/lint-meta-rules': patch
---

Require `@noctcore/harness` `^0.6.0` (was `^0.3.0`), so a consumer that also installs the harness gets one copy instead of a second, older one nested under this package. Every harness import in the package (`IMetaRule`, `IMetaCtx`, `IViolation`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline`) is unchanged in 0.6.0. The one visible change is that the default baseline directory of `file-size-ratchet` follows the harness constant, which is now `.noctcore/lint-meta/baselines`: a baseline that still lives under `.nightcore/lint-meta/baselines` is read with a deprecation warning until harness 1.0, and one present in both places is an error. Set `baselineDir` to pin a location. The README, the site and the rule description now name `.noctcore/`.
