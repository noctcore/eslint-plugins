---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` no longer reports a command whose every runtime part the function already proved harmless before the call: a value checked by an exiting `if` (or an `if` around the call) against an allowlist of literals (`includes` on an array literal, `has` on a `new Set([...])`, `===` / `!==` against literals) or against a regex anchored at both ends, without the `m` flag, that admits no shell metacharacter; the output of `schema.validate(x)` (with `if (error)` exiting) or `schema.parse(x)` when the schema's `pattern` / `regex` is such a regex or it is a literal `valid` / `enum` / `literal`; an in-file `const` literal; or a value read from `process.env`. Every write to the checked binding must come before the check, and `const` aliases and `String(x)` are followed. An unanchored regex, a regex admitting a metacharacter (`.`, `\s`, `;` ...), a check after the call or a check that does not exit keeps the report.

A project spreading `recommended` sees fewer errors, never new ones.
