---
"@noctcore/lint-meta-rules": patch
---

Test-only: the five CI-hygiene rules (`github-actions-sha-pinned`, `github-actions-runner-pinned`,
`service-image-digest-pin`, `dockerfile-base-image-digest-pin`, `security-scanner-version-parity`)
now also run against a real temp directory containing `.github/workflows/` and `.devcontainer/`,
through the real `harness lint-meta` CLI under Bun. The fake-context tests could not catch the Bun
dot-directory glob bug fixed in `@noctcore/harness` 0.3.0; these do. All five fail on harness 0.2.0
(including the false "no workflow pins" report that hid a real 8.19.0 vs 8.18.0 drift) and pass on
0.3.0. No runtime change.
