---
"@noctcore/lint-meta-rules": patch
---

Require `@noctcore/harness` `^0.3.0`.

This is a correctness bump, not housekeeping. Harness 0.3.0 fixes `ctx.glob`, which
under Bun returned an empty list for any dot-directory segment, including a fully
literal `.github/workflows/ci.yml`. Four of this package's CI-hygiene rules glob
exactly that path by default, so on harness 0.2.0 under Bun they reported nothing at
all, and `security-scanner-version-parity` reported a false violation while hiding a
real scanner drift.

A caret range on a `0.x` version never crosses the minor, so `^0.2.0` could not pick
the fix up on its own.
