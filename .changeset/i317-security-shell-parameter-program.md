---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` treats a program word that holds a shell parameter as a wrapper, so every value after it up to the next separator is a program word: `$SHELL -c ${t}`, `"$SHELL" -c "${t}"`, `W=sudo; $W ${t}`, `${SUDO:-sudo} ${t}` and bash's `$'env' ${t}` now need `t` proven by a literal allowlist or a constant, not a regex.
