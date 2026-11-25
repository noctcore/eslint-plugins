---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` counts a header name as `Location` when a runtime piece can finish it into one (`res.set('Loc' + n, url)`) or when it is joined from more than 16 possible texts, which it used to skip. A header name that is runtime as a whole (`res.setHeader(name, url)`) is still not read. Header names and headers holders reached through bindings that refer to each other in a cycle are now each read once, so a file with a few dozen such aliases no longer makes the rule run for minutes. A name passed down a chain of aliases is read whole however deep the chain is and whatever order its bindings are read in, so `const L = 'Location'` passed through six `const` aliases into `let N`, then `N = V`, is reported at `res.set(N, url)` and `res.writeHead(302, { [N]: url })`; past 256 aliases in one chain the name counts as `Location`.
