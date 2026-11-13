# `noctcore-contracts/route-params-validated`

> A route whose path declares `:name` parameters must have a param validator in its handler chain.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A path such as `/calls/:id` hands the handler a raw string. A param validator in the chain
(`param(CallIdSchema)`, `zValidator('param', CallIdSchema)`) turns it into a checked value before the
handler runs. A route that declares parameters and skips the validator trusts whatever the client sent.

## What it flags

A route call on a router, with a literal path that has `:name` segments, and no param validator among
its arguments. The report is on the path and names the parameters.

```ts bad reports=1
const app = new Hono();
app.get('/calls/:id', signedInOnly, async (c) => {});
```

```ts bad reports=1
const app = new Hono();
app.get('/calls/:id', signedInOnly, zValidator('json', BodySchema), async (c) => {});
```

```ts bad reports=1
const api = new Hono().basePath('/v1');
api.get('/a', handler).post('/b/:id', handler);
```

A router is `new Hono()`, a `const` bound to one (also through `.basePath(...)` and the other router
methods), or an identifier listed in `routerNames`. The methods are `get`, `post`, `put`, `patch`,
`delete` and `all`. Optional and constrained parameters (`:id?`, `:id{[0-9]+}`) count by their name.

## What it does not flag

A route with no `:name` segment, a route with a param validator, a call on something that is not a
proven router (`axios.get('/users/:id', config)`, `map.get(':id')`), a computed method, and a path that
is not a literal.

```ts good
const app = new Hono();
app.get('/calls/:id', signedInOnly, param(CallIdSchema), async (c) => {});
app.get('/orgs/:org', zValidator('param', OrgSchema), async (c) => {});
app.get('/calls', signedInOnly, async (c) => {});
axios.get('/users/:id', config);
map.get(':id');
app.get(path, handler);
```

A `.use(...)` call on the same router binding that carries a param validator silences every route on
that binding, wherever it appears in the file. It is coarse by design: the rule cannot tell which
routes the `.use` path covers.

```ts good
const app = new Hono();
app.use('/calls/:id/*', param(CallIdSchema));
app.get('/calls/:id', signedInOnly, async (c) => {});
```

### What it cannot see

- A router imported from another file.
- Sub-routers mounted with `app.route('/calls/:id', sub)` and routes added with `app.on(...)`.
- A router bound with `let` or `var`, or returned by a factory function.
- A route on `const api = app.basePath('/v1')`: `api` is its own router, so `app.use(param(S))` does not
  silence it.
- Raw `c.req.param('id')` reads: only the chain is checked, not what the handler does with it.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `validators` | `string[]` | `['param']` | Called names that count as a param validator. `param(S)` and `v.param(S)` both read as `param`. |
| `validatorFactories` | `string[]` | `['zValidator', 'validator']` | Called names whose first argument `'param'` makes a param validator. |
| `routerNames` | `string[]` | `[]` | Identifier names treated as routers besides `new Hono()` bindings. |

An option replaces its default rather than adding to it.

```js
'noctcore-contracts/route-params-validated': ['error', {
  validators: ['param', 'validateParams'],
  validatorFactories: ['zValidator', 'validator', 'sValidator'],
  routerNames: ['router'],
}]
```

```ts good reconfigured options={"validators":["validateParams"],"validatorFactories":["sValidator"],"routerNames":["router"]}
router.get('/calls/:id', validateParams(CallIdSchema), handler);
router.get('/orgs/:org', sValidator('param', OrgSchema), handler);
```

## When not to use it

If your routes read parameters through a validation layer the chain does not show (a framework that
validates from the route definition, or a router outside Hono), leave the rule off.
