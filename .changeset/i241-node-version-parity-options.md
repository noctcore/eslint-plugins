---
'@noctcore/lint-meta-rules': minor
---

`node-version-parity` gets three opt-in options for the setups it passes by default, so a repo that has adopted the convention can close each gap. All default to today's behavior.

- `requireVersionFile` (default `false`): report a missing version file instead of staying dormant. With no file there is no major, so nothing else is checked.
- `reportUnresolvableFrom` (default `false`): also report a variable `FROM` that does not mention node (`FROM $BASE`, `FROM ${BASE}`).
- `allowExpressionNodeVersion` (default `true`): set it to `false` to report a setup-node `node-version` written as an expression (`${{ vars.NODE_VERSION }}`, a matrix included), with a pointer to `node-version-file`.
