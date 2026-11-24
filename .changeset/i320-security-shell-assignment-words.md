---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reads a bash assignment before the program as one word through spaces inside its subscript brackets or quotes, and through nested brackets: `A[ 0 ]=x ${t}`, `A["x y"]=1 ${t}`, `A[a[0]]=x ${t}` and `A="x y" ${t}` run `t` as the program, so `t` now needs a program-name proof (a literal allowlist or a constant), not just a regex.
