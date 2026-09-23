---
'@noctcore/lint-meta-rules': minor
---

Two GitHub Actions security rules, both in `RULE_FACTORIES` (so `createAllRules()` now includes them).

`github-actions-no-template-injection` reports a `${{ }}` expression expanded into a `run:` script or an `actions/github-script` `script:` when it names attacker-controllable context: issue, PR, discussion and comment titles and bodies, head branch names, commit messages and authors, page names, and `inputs.*` (`checkInputs`, on by default; inputs declared `boolean`, `number` or `choice` are exempt). It scans workflows and composite `action.yml` files. The same expression under `env:`, `with:` or `if:` is left alone, as are `github.sha`, `matrix.*`, `secrets.*` and, unless `checkStepOutputs` is on, `steps.*.outputs.*`.

`github-actions-least-privilege-permissions` reports a workflow with no top-level `permissions:` (unless every job declares its own), a top-level `write-all` or `read-all`, and each top-level `<scope>: write` not listed in `allowTopLevelWrite`.

A consumer that registers every catalog rule will see new violations wherever its workflows do any of the above.
