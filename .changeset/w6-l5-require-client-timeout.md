---
'@noctcore/eslint-plugin-async-safety': minor
---

Add `require-client-timeout`: reports a configured client call or `new` whose options object literal sets none of the listed timeout keys. It ships with no built-in client list (`clients: []`, inert by default) and, like `require-fetch-timeout`, stays silent on spreads and opaque option bags. Enabled at `error` in `recommended`.
