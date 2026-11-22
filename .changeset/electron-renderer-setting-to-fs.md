---
'@noctcore/eslint-plugin-electron': minor
---

New rule `no-renderer-setting-to-fs`, shipped off and left out of `recommended`.

It reports, inside one function, a value read from a settings store the renderer can write (the calls you list in `sources`: a store call such as `{ object: 'store', method: 'get' }`, a `{ function: 'loadSettings' }` loader, or a `{ function: 'getSetting', returns: 'value' }` getter, optionally narrowed with `keys`) that reaches the path argument of an `fs` function or `shell.openPath` / `shell.showItemInFolder` / `shell.trashItem` without a containment check. A `startsWith` or `path.relative` test on the joined or resolved path, a call to one of your `sanitizers` (add `includes` for allowlist checks) and any helper call in between end the chain. Every tainted operand of a join, template or `+` is checked on its own. `path.basename` ends the chain for file sinks only: for `rm`, `rmdir`, `readdir`, `opendir`, `cp`, `rename`, `shell.trashItem` and `shell.openPath` it is not containment, since `path.basename('..')` is `'..'` and an empty or `.` name is the base itself. Without `sources` it reports nothing.

A project that spreads `recommended` as-is sees no new errors.
