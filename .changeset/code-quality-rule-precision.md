---
'@noctcore/eslint-plugin-code-quality': minor
---

Fix false positives and false negatives in five `recommended` rules, and add two editor suggestions.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- `skipped-tests-need-tracking` reads the tracking marker from comments only. Before, any text in the 30 lines above a skip counted, so a `const BASE = 'http://localhost:3000'` near the top of a test file exempted every skip below it. A marker now has to be in a comment on the skip's line, or in a comment that ends within `lookback` lines above it (the whole run of adjacent comment lines counts, so a URL at the top of a long `//` explanation still works). The `lookback` default drops from 30 to 3. A `node:test` reason given as text (`{ skip: 'https://...' }`) still counts. It now also reports a skip modifier anywhere in the chain: `it.concurrent.skip(...)` and `it.skip.each([...])(...)`. To keep the old window, set `lookback: 30`.
- `no-bare-date-now` now reports `Date()` called as a function and reads through the global object (`globalThis.Date.now()`, `new window.Date()`).

**Reports less:**

- `no-bare-date-now` exempts test files by default (`**/*.{spec,test}.*`, `**/__tests__/**`), like the other allowlisted rules. A project that sets `allowIn` replaces the default and sees no change. The messages no longer present `now()` / `nowMs()` as names the project must have.
- `skipped-tests-need-tracking` no longer reports Playwright's conditional skip, `test.skip(browserName === 'webkit', 'reason')`. `test.skip()` and `test.skip(true, 'reason')` are still reported.
- `no-historical-comments` no longer reports `no longer` describing runtime state ("the socket is no longer writable") or `historical` as a domain word ("historical exchange rates"). `we no longer`, `no longer needed/used/required/...` and `historically` are still reported.
- `no-pr-reference-comments` no longer reports a bare `#` number with one digit (`step #2`), a leading zero (`#000`), or a following `%` or letter. A new `trackerPatterns` option reports tracker keys such as Jira's (`['(?:OPS|WEB)-\\d+']`); it is empty by default.

**Suggestions:** `no-focused-tests` suggests removing `.only` (or `fit` to `it`), and `skipped-tests-need-tracking` suggests inserting a `// TODO(@owner):` line above the skip. Both are suggestions, not autofixes.
