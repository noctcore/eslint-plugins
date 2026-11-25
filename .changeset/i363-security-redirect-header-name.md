---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` counts a header name as `Location` when a runtime piece can finish it into one (`res.set('Loc' + n, url)`) or when it is joined from more than 16 possible texts, which it used to skip. A header name that is runtime as a whole (`res.setHeader(name, url)`) is still not read. Header names and headers holders reached through bindings that refer to each other in a cycle are now each read once, so a file with a few dozen such aliases no longer makes the rule run for minutes.
