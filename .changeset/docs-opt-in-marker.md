---
'@noctcore/eslint-plugin-architecture': patch
'@noctcore/eslint-plugin-async-safety': patch
'@noctcore/eslint-plugin-code-quality': patch
'@noctcore/eslint-plugin-contracts': patch
'@noctcore/eslint-plugin-llm': patch
'@noctcore/eslint-plugin-monorepo': patch
'@noctcore/eslint-plugin-observability': patch
'@noctcore/eslint-plugin-prisma': patch
'@noctcore/eslint-plugin-react': patch
'@noctcore/eslint-plugin-rsc': patch
'@noctcore/eslint-plugin-security': patch
---

Documentation only, no rule behaviour change. The README rules table now marks every rule as either ✅ on in `recommended` or 🔘 opt-in (off or left out of the preset), in a Preset column, so a rule you have to enable yourself no longer shows up as a blank row. Opt-in rule docs say the same in their status line. Package descriptions on npm now list what each plugin actually covers, and the monorepo quick start says plainly that `recommended` enables nothing until you give the rules your workspace scope.
