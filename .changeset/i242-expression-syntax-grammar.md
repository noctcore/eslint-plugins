---
'@noctcore/lint-meta-rules': minor
---

`github-actions-expression-syntax` now checks the shape inside a closed `${{ }}`, and two `if:` mistakes. Workflows that passed before can now report.

- Inside an expression: an empty `${{ }}`, unbalanced brackets (an unclosed call, an extra `)`), an operator with no left or right operand, two operands with no operator between them, an empty call argument, and `=`, `&` or `|` where `==`, `&&` or `||` was meant. A string that is never closed now gets its own message instead of "no closing `}}`". Names are not checked (an unknown function or context passes), and a `-` inside a name (`needs.build-job`) is part of the name.
- A single-line `if:` that mixes a `${{ }}` with other text, which GitHub reads as a string and so is always true, and an unquoted `if:` that starts with `!`, which YAML reads as a tag.
- A `''` in a single-quoted YAML value is read as the one quote GitHub sees, and a CRLF workflow is read like an LF one (before, a scalar wrapped over CRLF lines was not joined into one unit).
- YAML comments are skipped, as GitHub drops them before it reads any expression, so a `${{` in a whole-line or trailing comment is no longer reported. A `#` inside a quoted value or a `|` / `>` block scalar is still text, and ` #` inside a plain value ends it there, so `if: ${{ github.ref == 'a #b' }}` is reported as unclosed.
