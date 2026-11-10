---
'@noctcore/eslint-plugin-contracts': minor
---

`no-direct-process-env`: the default `allowedFiles` now also covers `.mts` / `.cts` config files, tests written as `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts`, and repo tooling under `tools/` (next to `scripts/`). The message no longer reads as framework specific and points at `allowedFiles` for a script whose environment is its input. A project that passes its own `allowedFiles` is unaffected.
