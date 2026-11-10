---
'@noctcore/lint-meta-rules': minor
---

Five supply-chain rules:

- `noctcore-packages-current`: every installed `@noctcore/*` package (or another `scope`) is inside its declared range, so a caret on 0.x cannot hide a published minor. Offline by default; `checkRegistry: true` also compares each range with the registry's latest version, skipping an unreachable registry and ignoring a stale read right after a publish.
- `pnpm-hardening-settings`: `pnpm-workspace.yaml` keeps `strictDepBuilds`, `blockExoticSubdeps`, `engineStrict`, `trustPolicy: no-downgrade` and a minimum release age on, every `trustPolicyExclude` entry is exact and reasoned, and nothing overrides them in `.npmrc`, `package.json` or on a command line.
- `node-version-parity`: `.nvmrc`, the root `engines.node`, every `actions/setup-node` step and every Docker node base image agree on the Node major.
- `banned-dependencies`: no workspace manifest declares a package you named, with your reason in the message.
- `pnpm-override-ledger`: every pnpm override has a dated, reasoned ledger entry, a security pin targets its own first patched version, and the lockfile honours the override.
