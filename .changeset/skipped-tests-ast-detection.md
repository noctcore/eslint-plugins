---
'@noctcore/eslint-plugin-code-quality': patch
---

`skipped-tests-need-tracking` no longer reports the text of a skip that is not a call.

**Reports less.** The rule found `it.skip(`, `test.fixme(`, `xit(`, `xdescribe(` and `xtest(` by scanning each source line, so the same text inside a string, a template literal or a comment was reported as a skipped test. It now reads the skip from the call itself. A test file that lints probe code held as a string (a config wiring test with seeded violations, a `RuleTester` suite for a wrapper rule) can spell a skipped test in its own source, and a comment can mention `it.skip(` in prose.

Every real skip that was reported before is still reported: the `.skip` / `.fixme` modifier on `it`, `test` or `describe` (also reached through a member, `test.describe.skip(`), and the `xit` / `xdescribe` / `xtest` aliases. The tracking marker is still looked up in the source text of the lookback window, so a marker in a comment counts as before.

The report now sits on the callee (`it.skip`, `xit`) or on the `node:test` option, where it used to cover the whole line from column 1. The line is unchanged, so an `eslint-disable-next-line` keeps working.
