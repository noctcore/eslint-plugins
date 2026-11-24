---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` reads constant text written through a wrapper that keeps it (`String(';')`, `';' as string`, `';' satisfies string`, `const P = String('sudo')`) as text, and a constant reached through a `const` chain too deep to inline is read as the text its proof rests on. A separator or wrapper written that way now moves the words after it: `` exec(`ls ${String(";")} ${t}`) ``, `` exec(`${"sudo" as string} ${t}`) `` and `` exec(`${P} ${t}`) `` with `const P = String("sudo")` need `t` proven as a program name. A template behind `as` (`` `ls ${`-l ${t}` as string}` ``) is read as its parts instead of being reported whole.
