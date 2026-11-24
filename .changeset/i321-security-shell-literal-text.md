---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reads a value proven by literals (an `includes` / `has` / `indexOf` allowlist, a `===` / `!==` comparison, a literal schema set, a constant reached through bindings) as the shell text it can hold, the way it already read in-file `const` strings. The command is read once for each text, and every reading must hold. So `` execSync(`A${e}1 ${t}`) `` after `if (e !== '=') return` (an assignment, then `t` as the program), `` execSync(`${kv} ${t}`) `` with `kv` in `['A=1']`, `` exec(`${p} ${t}`) `` with `p` in `['sudo', 'ls']`, `` exec(`ls ${s} ${t}`) `` with `s` in `[';', '&&']`, and `` exec(`rm -rf ${base}${x}`) `` with `base` in `['/srv/', '/tmp/']` (`x` is then a path segment) now need `t` or `x` proven for where it really lands. An allowlist of plain names (`['ls', 'date']`, `['git', 'hg']` behind `/usr/bin/`) reads as before.

A value proven in a way that does not show its text, a `process.env` value under `trustEnvironment`, may hold a separator or a wrapper: every value after it up to the next separator is now read as a program word, so `` exec(`${process.env.TOOL} ${t}`) `` and `` exec(`git -C ${process.env.REPO_DIR} log ${t}`) `` need `t` proven by a literal allowlist or a constant. A command with more than 64 readings treats its allowlisted values the same way.
