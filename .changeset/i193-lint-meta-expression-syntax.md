---
'@noctcore/lint-meta-rules': minor
---

Add the `github-actions-expression-syntax` rule and its factory `createGithubActionsExpressionSyntaxRule`. It reports a `${{` immediately followed by another `{` (the `${{{name}}}` slip in an f-string or script) and a `${{` with no closing `}}`, which make GitHub reject the whole workflow before any job runs. A folded, literal, plain or quoted scalar that wraps over several lines is read as one unit, so an expression may close on a later line of the same scalar, a quoted `}}` inside an expression is string text, and a `${{` in a YAML comment is checked like any other text. It takes `workflowGlobs` (default `.github/workflows/*.y(a)ml`) and `ciCritical` (default `true`). The factory is part of `RULE_FACTORIES`, so `createAllRules()` now includes it: a caller of `createAllRules()` will see new violations on a workflow with a malformed `${{`. lint-meta has no `recommended` preset, and a caller that picks factories one by one sees nothing new.
