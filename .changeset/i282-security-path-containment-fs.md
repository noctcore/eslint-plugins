---
'@noctcore/eslint-plugin-security': minor
---

`require-path-containment` (opt-in) now follows request-shaped input into filesystem calls, not only into `path.join` / `path.resolve`. The path argument of an `fs` call that reads, writes or deletes (`readFile`, `writeFile`, `unlink`, `rm`, `createReadStream` and the rest, sync, callback and promise forms, through `fs`, `fs.promises`, `fs/promises`, a `require` or import under any name, or named imports), both paths of `rename` / `copyFile` / `cp` / `link` / `symlink`, and Express `res.sendFile` / `res.download`, is reported with the new message id `unguardedFsPath` when a `requestObjects` member reaches it through the function: bindings (every assignment), destructuring, `for...of`, `+` and templates, member access, object and array literals (getters included), calls taking it, and `push` into an array.

The flow stops at `path.basename`, `Number` / `parseInt` / `parseFloat`, a callee in the new `sanitizers` option, a value checked before the call against an allowlist or an anchored regex that admits no `/`, `\` or `:`, and a `join` / `resolve` result that the existing containment test takes. A `join` with a direct `req.*` argument is still reported once, at the join.

The rule is not in `recommended`, so a project spreading `recommended` sees no new errors. A project that enabled it can see new reports on fs calls whose path is built from request input.
