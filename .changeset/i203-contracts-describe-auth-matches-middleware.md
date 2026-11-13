---
'@noctcore/eslint-plugin-contracts': minor
---

Add `describe-auth-matches-middleware`, an opt-in rule that reads the docs call of a route method call (`describe({ auth: 'session' })`, with `get`, `post`, `put`, `patch`, `delete` or `all` and a literal path) and checks it against the chain: it reports a declared kind whose middleware is missing, middleware that is mapped only to another kind, and a declared kind that is not a key of `map`. It needs `map`, from each auth kind to the middleware names that satisfy it, and does nothing without it; `docsCallee` and `authProperty` change which call and property are read. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.
