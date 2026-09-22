# `noctcore-async-safety/require-client-timeout`

> A configured network client must be constructed with a timeout option. An unbounded client can hang
> forever.

## Why

Many clients are configured once, at construction, and never see a per-request `signal`: an S3 client
whose request handler has no connection timeout, an SMTP transport with no connection or socket
timeout, a database pool with no connect timeout. A peer that accepts the connection and never answers
leaves every caller waiting indefinitely. [`require-fetch-timeout`](./require-fetch-timeout.md)
covers `fetch`; this rule covers the clients you name.

## What it flags

The rule ships knowing **no** client. For each entry in `clients`, it reports a matching call (or
`new`, with `construct: true`) whose options visibly carry none of the `requireAnyOf` keys.

It follows the same precision contract as `require-fetch-timeout`: no type information, and silent
whenever it cannot see the options.

- A spread argument (`new Client(...args)`) or a `...spread` inside the options literal is opaque:
  skipped.
- An options slot that is an identifier, call or member (`new Client(config)`) may already set a
  timeout: skipped.
- It reports a visible options object literal with none of the keys, or an argument list with nothing
  but string/template literals (a connection URL), including no arguments at all.

Keys are matched at the top level of the options object only.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `clients` | `{ callee, construct?, requireAnyOf }[]` | `[]` | The clients to check. |
| `clients[].callee` | `string` | (required) | Dotted callee text, matched literally: `'S3Client'`, `'nodemailer.createTransport'`. |
| `clients[].construct` | `boolean` | `false` | Match `new <callee>(...)` instead of `<callee>(...)`. |
| `clients[].requireAnyOf` | `string[]` (at least one) | (required) | The options object must carry at least one of these top-level keys. |

With the default `clients: []` the rule is inert, which is why `recommended` can ship it at `error`.

## Worked example

A NestJS API that talks to S3 and sends mail over SMTP:

```js
'noctcore-async-safety/require-client-timeout': [
  'error',
  {
    clients: [
      // AWS SDK v3: timeouts live on the request handler.
      { callee: 'S3Client', construct: true, requireAnyOf: ['requestHandler'] },
      // Nodemailer SMTP transport.
      {
        callee: 'nodemailer.createTransport',
        requireAnyOf: ['connectionTimeout', 'socketTimeout'],
      },
    ],
  },
],
```

```ts bad reports=2 options={"clients":[{"callee":"S3Client","construct":true,"requireAnyOf":["requestHandler"]},{"callee":"nodemailer.createTransport","requireAnyOf":["connectionTimeout","socketTimeout"]}]}
// no request handler, so no connection or request timeout
this.s3 = new S3Client({ region, credentials });

// SMTP transport with default (unbounded in practice) timeouts
this.transporter = nodemailer.createTransport({ host, port, secure: true });
```

```ts good options={"clients":[{"callee":"S3Client","construct":true,"requireAnyOf":["requestHandler"]},{"callee":"nodemailer.createTransport","requireAnyOf":["connectionTimeout","socketTimeout"]}]}
this.s3 = new S3Client({
  region,
  credentials,
  requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
});
this.transporter = nodemailer.createTransport({
  host,
  port,
  secure: true,
  connectionTimeout: 10_000,
});
```

## Limits

- It enforces that a listed key is **present**, not that its value is a sane timeout.
  `requestHandler: new NodeHttpHandler({})` passes.
- Matching is by callee text. An aliased import (`import { S3Client as S3 }`) or a destructured factory
  (`const { createTransport } = nodemailer`) is not matched unless you list that name too.
- A client built from an opaque config object (`new S3Client(config)`) is never reported.
