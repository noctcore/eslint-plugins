---
'@noctcore/eslint-plugin-prisma': minor
---

New rule `no-request-body-in-write`, in `recommended` at `error`: a project that spreads `recommended` will see new errors wherever a Prisma write takes its payload straight from the request.

It flags mass assignment: a write whose `data` (or an `upsert`'s `create` / `update`) is `req.body`, `request.body`, `ctx.request.body`, `req.query`, `await req.json()`, `await request.json()`, `c.req.json()`, `c.req.parseBody()` or `Object.fromEntries` over a `FormData`, directly, through a `const`, as a spread, as a `createMany` element or inside a nested relation write. It also flags the same input used as a write's `where`, where a caller can send operators and widen an `updateMany` or `deleteMany`. It leaves alone anything parsed first (`Schema.parse(req.body)`), fields picked one by one, and spreads it cannot trace to a source. The source list is the `sources` option.
