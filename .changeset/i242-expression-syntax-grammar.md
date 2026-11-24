---
'@noctcore/lint-meta-rules': minor
---

`github-actions-expression-syntax` now checks the shape inside a closed `${{ }}`, and two `if:` mistakes. Workflows that passed before can now report.

- Inside an expression: an empty `${{ }}`, unbalanced brackets (an unclosed call, an extra `)`), an operator with no left or right operand, two operands with no operator between them, an empty call argument, and `=`, `&` or `|` where `==`, `&&` or `||` was meant. A string that is never closed now gets its own message instead of "no closing `}}`". Names are not checked (an unknown function or context passes), and a `-` inside a name (`needs.build-job`) is part of the name.
- An `if:` that mixes a `${{ }}` with other text, which GitHub reads as a string and so is always true, and an unquoted `if:` that starts with `!`, which YAML reads as a tag. The parsed value is checked, so a quoted, wrapped or block `if:` is checked too; a core tag such as `!!str` is not reported.
- Workflows are now read with a YAML parser (the `yaml` package, a new dependency with no dependencies of its own) instead of line by line. Each scalar, key or value, plain, quoted or block, is checked as GitHub gets it, at its exact source line: comments never reach the checks, a `''` in a single-quoted value is one quote, double-quoted escapes are decoded, and a `#` inside a quoted value or a `|` / `>` block scalar is text. In a plain value ` #` starts a comment, so `if: ${{ github.ref == 'a #b' }}` is reported as unclosed, with a hint to quote the value. A CRLF workflow is read like an LF one.
- A workflow that is not valid YAML (a duplicate key, a tab as indentation, an unclosed quote or flow list, more than one document) is now reported at the parser's first error, since GitHub rejects it too; it was passed silently before.
