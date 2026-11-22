---
'@noctcore/eslint-plugin-electron': minor
---

New rule `no-renderer-setting-to-fs`, shipped off and left out of `recommended`.

It reports, inside one function, a value read from a settings store the renderer can write (the calls you list in `sources`, such as `{ object: 'store', method: 'get' }` or a `{ function: 'loadSettings' }` loader, optionally narrowed with `keys`) that reaches the path argument of an `fs` function or `shell.openPath` / `shell.showItemInFolder` / `shell.trashItem` without a containment check. A `startsWith` or `path.relative` test on the joined or resolved path, a call to one of your `sanitizers`, `path.basename` and any helper call in between end the chain. Without `sources` it reports nothing.

A project that spreads `recommended` as-is sees no new errors.
