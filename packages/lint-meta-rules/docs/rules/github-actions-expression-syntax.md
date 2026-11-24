# `github-actions-expression-syntax`

> A workflow never holds a malformed `${{ }}` expression, which fails the whole workflow before any job runs, nor an `if:` that is always true.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createGithubActionsExpressionSyntaxRule` from `@noctcore/lint-meta-rules` · Category `ci` · Fails CI by default: yes
<!-- end generated rule header -->

## Why

GitHub parses every `${{ ... }}` in a workflow file before it schedules a job. One bad opener makes
the workflow invalid: it fails in zero seconds with no job logs, and any required check it was meant
to report stays pending. Two slips cause nearly all of it. A script or f-string that writes a literal
`${{{name}}}` (the opener is followed by another brace), and an expression whose closing `}}` was
lost in an edit.

## What it flags

A `${{` immediately followed by another `{`, and a `${{` with no closing `}}`. The workflow is read
with a YAML parser, and each scalar (key or value: plain, quoted, literal `|` or folded `>`) is
checked as one unit, so an expression may close on a later line of the same scalar but not past its
end. A second `${{` before the first one closes is also reported, at the first opener. Reported lines
are the source lines of the opener.

Each scalar is read as GitHub gets it. YAML comments never reach the checks, because GitHub parses the
YAML first and never sees them. A `#` inside a quoted value or a `|` / `>` block scalar is text, and
so is a `#` after a non-breaking space. A `''` in a single-quoted value is one quote, and a
double-quoted value's escapes (`\"`, `\x27`, an escaped line break) are decoded. In a plain value,
` #` starts a comment even inside what looks like an expression, so
`if: ${{ github.ref == 'a #b' }}` reaches GitHub as an unclosed `${{ github.ref == 'a`; the message
then says to quote the value to keep the `#`.

The YAML is read as close to GitHub's reader as the parser gets: not strict, so a `|# note` header,
`"x"#c` and long or multi-line implicit keys pass, and a flow collection or quoted value continued
below its parent's indent (which GitHub accepts) is read as GitHub reads it. What GitHub fails to
load is reported: a duplicate key (compared without case, so `On` repeats `on`; a key holding
`${{` is an expression and is not compared), an alias to an anchor not defined before it, more than
one document, a `---` or `...` line at column 0 inside a quoted value or flow collection, an unclosed
quote or bracket, a tab used as indentation. A parse error is reported once, at the parser's first error, and the file's expressions
are checked once it parses.

Inside a closed `${{ }}`, the shape of the expression: a string that is never closed, an empty
expression, unbalanced brackets, an operator with no left or right operand, two operands with no
operator between them, an empty call argument, and `=`, `&` or `|` where `==`, `&&` or `||` was
meant. GitHub rejects the workflow for each of these too.

Two kinds of `if:` value, at job level (`jobs.<id>.if`) and step level (`jobs.<id>.steps[*].if`);
an `if` key anywhere else, such as an action input under `with:`, is not a condition. First, one with
any text outside its `${{ }}`, which GitHub reads as a string, and a non-empty string is always true,
so the condition never skips anything. GitHub keeps every character of the value, so this includes
whitespace: spaces inside quotes (`if: " ${{ a }}"`) and the trailing newline a block keeps. Of the
block styles, only `|-` and `>-` strip it; `|`, `>`, `|+` and `>+` make the condition always true.
Spaces after the `}}` stay even in `|-` or `>-`, and are reported as padding. A block `if:` with no
`${{ }}` at all is a plain expression and is fine in any style. Second, an
unquoted one that starts with `!`, which YAML reads as a tag, not a negation. A core tag YAML
resolves itself (`if: !!str ${{ ... }}`) is not reported.

```yaml
# Bad
- run: python -c "print(f'${{{name}}}')"
if: ${{ github.ref == 'refs/heads/main'
if: ${{ contains(github.ref, 'x' }}
if: ${{ github.actor = 'bot' }}
if: ${{ github.ref == 'x' }} && github.actor == 'y'
if: !cancelled()
if: |
  ${{ github.event_name == 'push' }}

# Good
- run: python -c "print(f'$' + '{{' + name + '}}')"
if: ${{ github.event_name == 'push' }}
if: >-
  ${{ github.event_name == 'push' &&
  github.ref == 'refs/heads/main' }}
```

## What it does not flag

- Names inside a well-formed expression (an unknown function or context, a wrong argument count):
  it checks the shape, not the names. A workflow linter such as actionlint covers those.
- A `-` inside a name (`needs.build-job.result`): GitHub has no minus operator, so it is part of the
  name.
- An expression that spans lines inside a block or multi-line scalar and closes before the scalar ends.
- A `'}}'` or `'${{'` inside a single-quoted string within an expression: it is string text, and `''`
  is an escaped quote.

## Options

```ts
createGithubActionsExpressionSyntaxRule(options?: GithubActionsExpressionSyntaxOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `workflowGlobs` | `string[]` | `['.github/workflows/*.yml', '.github/workflows/*.yaml']` | Workflow files to scan. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## When not to use it

If your workflows are generated and validated by a tool that already rejects malformed expressions
before they are committed, this adds nothing.

## Related

- [`github-actions-no-template-injection`](./github-actions-no-template-injection.md) checks the
  well-formed expressions for untrusted input in `run:` scripts.
