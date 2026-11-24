---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` treats a leading `+` like a leading `-` at the start of a word: a guard regex that admits `+` must pin the first character to something else. Some tools read `+` as an option prefix, so `` exec(`dig ${name} example.com`) `` after `/^[\w.+]+$/.test(name)` lets `name = '+short'` change the output (also `set +x`, `sort +1`, `more +/pattern`). A value glued to text before it (`--tag=${x}`) may still start with `+`.
