---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` counts the backslashes before the `>` or `<` in front of an `&`. An escaped `\>` does not make `>&` a redirect, so `` exec(`echo \>&${t}`) `` (the shell runs `echo` in the background, then `t` as a program) now needs `t` proven as a program name, not just by a regex. An even run of backslashes (`\\>&${t}`) leaves the redirect as it was.
