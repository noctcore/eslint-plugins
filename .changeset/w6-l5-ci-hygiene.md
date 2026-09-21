---
'@noctcore/lint-meta-rules': minor
---

Add five CI-hygiene rule factories (category `ci`): `createGithubActionsShaPinnedRule`, `createGithubActionsRunnerPinnedRule`, `createServiceImageDigestPinRule`, `createDockerfileBaseImageDigestPinRule` and `createSecurityScannerVersionParityRule`. Each project-specific constant (workflow and Dockerfile/compose globs, skip dirs, the floating-label pattern, the unpinned-image exemption list, and the scanner name, variables and hook path) is a factory option with a default.
