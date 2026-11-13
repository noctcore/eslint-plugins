# `noctcore-contracts/route-handler-order`

> The middleware arguments of a route method call must follow a configured group order, with the handler last.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

In a router method chain the order of the arguments is behaviour. An auth check placed after a body
validator answers a signed-out caller who sent a bad body with a 400 instead of a 401, and a docs
middleware placed after the handler is never reached. Teams settle on one order (docs, auth,
validators, handler), but nothing enforces it, so one route in a hundred drifts.

## What it flags

A route call whose argument sits in an earlier group than an argument before it. Each argument after
the path is classified by its dotted name: a bare reference such as `signedInOnly` or `auth.signedIn`,
or the callee of a call such as `body(S)` or `v.body(S)`. Every out-of-order argument is reported once,
naming its own group and the latest group already seen.

```ts bad reports=2 options={"groups":[{"name":"docs","callees":["describe"]},{"name":"auth","callees":["signedInOnly"]},{"name":"validate","callees":["body"]}]}
app.post('/x', body(S), signedInOnly, describe(d), handler);
```

```ts good options={"groups":[{"name":"docs","callees":["describe"]},{"name":"auth","callees":["signedInOnly"]},{"name":"validate","callees":["body"]}]}
app.post('/x', describe(d), signedInOnly, body(S), handler);
```

## What it does not flag

Matching is exact on the dotted name, so a `body` entry does not match `v.body(S)`. An argument that
matches no group, a spread argument and an inline function are skipped and do not reset the order. The
last argument is the handler and is never classified, even when its name is in a group.

```ts good options={"groups":[{"name":"docs","callees":["describe"]},{"name":"auth","callees":["signedInOnly"]},{"name":"validate","callees":["body"]}]}
app.post('/x', describe(d), logger, signedInOnly, body(S), handler);
app.post('/x', body(S), signedInOnly);
map.get('k');
client.post('/x', body);
```

Only `get`, `post`, `put`, `patch`, `delete` and `all` calls whose first argument is a string literal
or a template literal without expressions are read, on any receiver. `.use(...)`, arrays of middleware
and `on(method, path, ...)` calls are not read. A callee listed in two groups belongs to the first.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `groups` | `{ name: string, callees: string[] }[]` | `[]` | Ordered groups. `name` is used in reports; `callees` are the dotted names that put an argument in the group. |

**Inert until configured.** With `groups` empty the rule reports nothing, because there is no universal
order to hard-code.

```js
'noctcore-contracts/route-handler-order': ['error', {
  groups: [
    { name: 'docs', callees: ['describe'] },
    { name: 'auth', callees: ['signedInOnly'] },
    { name: 'validate', callees: ['body'] },
  ],
}]
```

## When not to use it

If your routes do not take middleware as arguments of a method call, or the order is enforced by the
framework, leave `groups` empty (the rule stays inert) or the rule off.
