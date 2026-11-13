# `noctcore-contracts/describe-auth-matches-middleware`

> The auth kind a route docs call declares must match the middleware in the same route chain.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A route's docs call can declare `auth: 'session'` while the chain has no session middleware, or the
reverse. The generated security entry then says one thing and the route does another, and nobody
notices until a client trusts the documentation. The docs call and the middleware sit in the same
call, so the two can be checked against each other.

## What it flags

A route call whose docs call declares a kind and whose chain disagrees, in three ways:

- the chain holds none of the middleware names mapped to the declared kind (reported on the kind),
- the chain holds middleware that is mapped to another kind and not to the declared one (reported on
  that argument, once each),
- the declared kind is not a key of `map`, which is how a typo such as `'sesion'` shows up.

```ts bad reports=1 options={"map":{"session":["requireSession"],"apiKey":["requireApiKey"],"public":[]}}
app.get('/me', describe({ auth: 'session' }), handler);
```

```ts bad options={"map":{"session":["requireSession"],"apiKey":["requireApiKey"],"public":[]}}
app.get('/health', describe({ auth: 'public' }), requireSession, handler);
```

```ts good options={"map":{"session":["requireSession"],"apiKey":["requireApiKey"],"public":[]}}
app.get('/me', describe({ auth: 'session' }), requireSession, handler);
app.get('/account', requireSession(), describe({ auth: 'session' }), handler);
app.get('/health', describe({ auth: 'public' }), handler);
```

## What it does not flag

A route with no docs call, a docs call whose kind is not a string literal, a middleware that no `map`
entry names, a chain with a spread argument, a call whose first argument is not a static path, a
method outside `get`, `post`, `put`, `patch`, `delete` and `all`, and a test-runner
`describe('name', fn)` that is not an argument of a route call. The last argument is the handler and
is never read as middleware or as the docs call.

```ts good options={"map":{"session":["requireSession"],"apiKey":["requireApiKey"],"public":[]}}
app.get('/me', requireApiKey, handler);
app.get('/me', describe({ auth: kind }), handler);
app.get('/me', describe({ auth: 'session' }), requireSession, logger, handler);
app.get('/me', describe({ auth: 'public' }), ...middleware, requireSession, handler);
app.get(path, describe({ auth: 'session' }), handler);
app.head('/me', describe({ auth: 'session' }), handler);
describe('routes', () => {
  it('works', () => {});
});
```

Names match exactly on the dotted path, so a `requireSession` entry does not match
`auth.requireSession`. Router-level middleware (`app.use(...)`), middleware inside arrays and a docs
call that wraps the route call are not read.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `map` | `Record<string, string[]>` | `{}` | Auth kind to the dotted middleware names that satisfy it. A list holds alternatives: any one name satisfies the kind. An empty list means the kind needs no middleware. |
| `docsCallee` | `string` | `'describe'` | Dotted name of the docs call among the route arguments. |
| `authProperty` | `string` | `'auth'` | Property of the docs call's first object argument that names the kind. |

**Inert until configured.** Without a non-empty `map` the rule reports nothing, because no middleware
name is universal.

```js
'noctcore-contracts/describe-auth-matches-middleware': ['error', {
  map: {
    session: ['requireSession'],
    apiKey: ['requireApiKey'],
    public: [],
  },
}]
```

A renamed docs call is read only when configured:

```ts good reconfigured options={"map":{"session":["requireSession"]},"docsCallee":"openapi","authProperty":"security"}
app.get('/me', openapi({ security: 'session' }), requireSession, handler);
```

## When not to use it

If your routes do not declare auth in a docs call inside the route chain, or the security entry is
generated from the middleware itself, leave `map` empty (the rule stays inert) or the rule off.
