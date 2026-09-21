---
"@noctcore/lint-meta-rules": patch
---

Bump the `@noctcore/harness` dependency range to `^0.2.0`. No consumed API changed (types and runtime exports used by this package — `IMetaRule`, `IViolation`, `IMetaCtx`, `DEFAULT_BASELINE_DIR`, `isGrandfathered`, `loadBaseline` — are unchanged between harness 0.1.0 and 0.2.0); this only widens the resolvable dependency range.
