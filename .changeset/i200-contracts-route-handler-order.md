---
'@noctcore/eslint-plugin-contracts': minor
---

Add `route-handler-order`, an opt-in rule that reports an argument of a route method call (`get`, `post`, `put`, `patch`, `delete`, `all` with a literal path) that comes after an argument of a later group, so an auth check cannot sit behind a body validator and a docs middleware cannot sit behind the handler. It needs `groups`, an ordered list of `{ name, callees }`, and does nothing without it; the last argument is the handler and is never classified. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.
