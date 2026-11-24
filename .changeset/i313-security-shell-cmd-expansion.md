---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` no longer accepts a guard regex that admits `%`. On Windows, Node runs an `exec` command through `cmd.exe`, which expands `%VAR%` anywhere in a word before it reads `&` or `|`, so `` exec(`echo ${x}`) `` after `/^[\w%]+$/.test(x)` runs with `x = '%PATH%'` expanded. `!` and `^` (delayed expansion and the `cmd.exe` escape) were already refused.
