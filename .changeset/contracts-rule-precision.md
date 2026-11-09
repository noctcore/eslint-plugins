---
'@noctcore/eslint-plugin-contracts': minor
---

Fix false positives and false negatives in six rules, and stop one autofix writing code that does not compile.

**A project that spreads `recommended` can see new errors**, which is why this is a minor bump:

- `money-must-be-decimal` now checks a money-named key typed `z.number()` in a `z.object({...})` (`checkZod`, on by default; `zodIdentifiers` for a renamed import), and treats `number | null` / `number | undefined` like `number`. Interface members and function parameters are new opt-in checks (`checkTypeMembers`, `checkParameters`, both off), so the documented "type members stay out of scope" default holds.
- `no-error-stringify` now reports any name bound by a `catch (x)` clause or a rejection handler (`.catch((x) => ...)`, the second callback of `.then`), whatever the name.
- `zod-schema-naming` now sees schemas built from a local schema const (`Base.extend({...})`), from an identifier named like a schema (`BaseSchema.extend({...})`), and from a renamed zod import listed in the new `zodIdentifiers` option.

**Reports less:**

- `money-must-be-decimal` no longer reports counts: a name with a counter word (`totalPages`, `totalCount`, `priceIndex`, `total_items`; configurable with `counterWords`) and a bare `total` on a pagination-shaped class or type (`PageMetaDto`, `PaginatedResult`).
- `no-error-stringify` drops `e` and `cause` from the default `errorIdentifierNames` (now `error`, `err`), so `sizes.map((e) => \`${e}px\`)` and `` `because ${cause}` `` are no longer reported; a catch-bound `e` still is. A project that set `errorIdentifierNames` keeps its list. The message now says what the coercion actually produces (`"Error: <message>"` or `"[object Object]"`), and each report offers a suggestion that rewrites to `x instanceof Error ? x.message : String(x)`.
- `env-var-schema-parity` (opt-in) no longer reports keys the runtime defines (`MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`, `NODE_ENV`), and re-reads the schema when its mtime moves, so an editor session sees a newly declared key without a restart. It now also checks destructured keys (`const { FOO } = process.env`).

**Autofix change:** `require-error-cause` autofixes only for the built-in errors and constructors listed in the new `autofixConstructors` option. Any other `*Error` / `*Exception` gets the same edit as a suggestion, because appending `{ cause }` to a constructor that does not take options was a type error (`new AppError('E_RUN', 'run failed')` became a three-argument call).

**Opt-in rule fix:** `require-registered-keys` now matches a sink rooted at `this` (`this.redis.set(...)`), and a sink with two or more segments matches as a dotted suffix (`redis.set` covers `this.redis.set`, `localStorage.getItem` covers `window.localStorage.getItem`).
