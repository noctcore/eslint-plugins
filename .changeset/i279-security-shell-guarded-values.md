---
'@noctcore/eslint-plugin-security': patch
---

`no-shell-interpolation` no longer reports a command whose every runtime part the function already proved harmless before the call, in the same function: a value checked by an exiting `if` (or an `if` around the call) against an allowlist of literals (`includes` on an array literal, `has` on a `new Set([...])`, `===` / `!==` against literals, `==` / `!=` against a string literal) or against a regex anchored at both ends, without the `m` flag, that admits no shell metacharacter and no whitespace, and cannot start with `-` or `#` (a leading `-` or `#` is allowed only when the value is glued to text before it in the same word, such as `--author=${x}`, and that text does not end in `-` or `+`); the output of `schema.validate(x)` (with `if (error)` exiting) or `schema.parse(x)` when the schema chain only narrows and its `pattern` / `regex` is such a regex or it is a literal `valid` / `enum` / `literal`; or an in-file `const` literal.

The proof is strict: a list in a `const` counts only if it is never exported or changed; a write to the checked binding after the check, from a nested function, or an in-place change (`push`, `x[0] = y`) cancels it; a check outside a callback or above a hoisted function does not count inside it; and a schema chain with `default`, `catch`, `failover`, `pipe` or a `pattern` options argument, or one that does not start at the zod or joi import, is not read; a parsed object or `safeParse` result that is changed anywhere (`result.data = x`, `Object.assign(result, x)`, an alias), or a field a spread or later key can replace, does not count; an imported binding, an exported regex or one whose `test` is replaced is never trusted.

New option `trustEnvironment` (default `false`): leave values read from `process.env` with a fixed key alone. It is off by default because CI variables such as `GITHUB_HEAD_REF` hold outside input, so `` exec(`git checkout ${process.env.GITHUB_HEAD_REF}`) `` is still reported.

A project spreading `recommended` sees fewer errors, never new ones.
