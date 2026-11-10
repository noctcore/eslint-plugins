---
"@noctcore/eslint-plugin-architecture": major
"@noctcore/eslint-plugin-code-quality": major
"@noctcore/eslint-plugin-contracts": major
"@noctcore/eslint-plugin-react": major
"@noctcore/eslint-plugin-async-safety": major
"@noctcore/eslint-plugin-observability": major
"@noctcore/eslint-plugin-security": major
"@noctcore/eslint-plugin-prisma": major
"@noctcore/eslint-plugin-monorepo": major
"@noctcore/lint-meta-rules": major
---

First stable release. These plugins are used by real projects and their presets follow the settled policy: `recommended` holds rules that are safe for any repo, and house conventions moved to `strict` in the plugins that have them (architecture, code-quality, contracts, react). From 1.0 on, a rule entering `recommended` or a rule's default becoming stricter is a major change, so a caret range on 1.x keeps getting fixes and new opt-in rules without surprise errors.

Peer ranges stay at `eslint >=9.0.0 <11` and `typescript >=5.0.0 <7`. Renamed options and merged rules keep their old names as deprecated aliases through 1.x.
