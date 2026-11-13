---
'@noctcore/eslint-plugin-contracts': minor
---

Add `route-params-validated`, an opt-in rule that reports a route call (`get`, `post`, `put`, `patch`, `delete` or `all` with a literal path) on a router the file proves, `new Hono()` or a `const` bound to one, when the path declares `:name` parameters and no argument in the chain is a param validator. A call to a name in `validators` (default `param`, so `v.param(Schema)` counts) or to a name in `validatorFactories` (default `zValidator` and `validator`) whose first argument is `'param'` counts as one; `routerNames` (default none) adds identifier names treated as routers. A `.use(...)` call carrying a param validator on the same router binding silences its routes. The rule is in neither `recommended` nor `strict`, so a project spreading either preset sees no new errors.
