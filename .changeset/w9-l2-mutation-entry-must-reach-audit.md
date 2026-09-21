---
'@noctcore/eslint-plugin-prisma': minor
---

Add `mutation-entry-must-reach-audit`, the rule that checks audits exist, where `no-audit-write-in-transaction` only checks where they sit.

For each mutation entry point (a method decorated `@Mutation()` by default, configurable with `entryDecorators`), it follows the calls the TypeScript checker resolved across files and reports the entry when a Prisma write is reachable, no audit write is reachable, and the whole call graph was read. An entry with an edge the rule cannot read (an interface or abstract method, a function held in a parameter, a value typed `any`) is skipped, never reported. `unauditedModels` exempts models whose writes are deliberately not audited, and `ignoreEntries` exempts single entries.

It proves that an audit is reachable from the entry, not that it runs on every path or records this write, and it does not look at mutations no entry point reaches. It needs type information and throws without it, so it is not in `recommended`. The docs list its blind spots and a measurement on a production API: 80 entries, 7 reported, all 7 hand-checked.
