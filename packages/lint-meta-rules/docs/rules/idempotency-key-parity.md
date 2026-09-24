# `idempotency-key-parity`

> A procedure guarded by an idempotency middleware has a client caller that sends the key, or no
> client caller at all.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createIdempotencyKeyParityRule` from `@noctcore/lint-meta-rules/trpc` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `trpc` entry point:

```ts
import { createIdempotencyKeyParityRule } from '@noctcore/lint-meta-rules/trpc';
```

## Why

An idempotency middleware only de-duplicates when the client sends a key, and neither half fails when
the other is missing. The server passes the request straight through, the client gets a normal
response, and both test suites pass. A guard nobody sends a key to is decoration advertising
double-submit protection that does not exist. In the project this rule was extracted from, an audit
found 14 of 30 guarded procedures whose only web caller had never sent a key.

The gap is only visible by holding the two lists side by side, which is what this rule does.

## What it flags

For every method in a `routerGlobs` file decorated with a `@<middlewareDecorator>(...)` list naming
`middleware` (as a whole word), the rule derives `<alias>.<method>` from the class's
`@<routerDecorator>({ <aliasKey>: '...' })`. If some `clientGlobs` file contains
`<clientPrefix><alias>.<method>` and none of those files contains `keyToken`, the router file is
reported.

The method is read from the decorator to the next `async <name>(`, the shape `nestjs-trpc` routers
take.

## What it leaves alone

- A guarded procedure with no client caller: the guard is correct in advance of the screen that will
  use it, and demanding a caller would be demanding the screen.
- A procedure without the middleware, even when a client sends it a key: the header is ignored, so it
  is inert rather than misleading.
- A middleware whose name merely starts with the configured one (`IdempotencyMiddlewareLegacy`).
- Procedures listed in `exempt`, and a router file with no alias.

A key sent from a DIFFERENT client file than the one naming the call counts, and so does a client test
file, if `clientGlobs` match it: the check is per procedure, across the client tree.

With no `middleware` the rule is inert.

## Factory

```ts
createIdempotencyKeyParityRule(options?: IdempotencyKeyParityOptions): IMetaRule
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | `'idempotency-key-parity'` | Rule id. |
| `middleware` | `string` | none (inert) | The middleware class that de-duplicates on a client-sent key. |
| `routerGlobs` | `string[]` | `[]` | Server router files. |
| `clientGlobs` | `string[]` | `[]` | Every client file that can call a procedure or send a key. |
| `keyToken` | `string` | `'idempotencyKey'` | The token a client file must mention to count as sending a key. |
| `clientPrefix` | `string` | `'trpc.'` | What precedes `<alias>.<method>` at a client call site. |
| `routerDecorator` | `string` | `'Router'` | The class decorator that names the router. |
| `aliasKey` | `string` | `'alias'` | The key in that decorator's object holding the alias. |
| `middlewareDecorator` | `string` | `'UseMiddlewares'` | The method decorator listing a procedure's middlewares. |
| `exempt` | `string[]` | `[]` | `<alias>.<method>` procedures whose caller deliberately sends no key. Keep it empty: the honest fix is to drop the middleware. |
| `skipDirs` | `string[]` | `node_modules`, `.git`, `dist`, `.turbo`, `coverage` | Path segments skipped. |
| `hint` | `string` | none | Appended to every message: how this project threads the key. |
| `ciCritical` | `boolean` | `true` | Whether a violation fails CI. |

## Worked example: Settly

```ts
createIdempotencyKeyParityRule({
  middleware: 'IdempotencyMiddleware',
  routerGlobs: ['apps/api/src/**/*.router.ts'],
  clientGlobs: ['apps/web/src/**/*.{ts,tsx}'],
  hint: "Thread `trpc: { context: { idempotencyKey } }` through the hook's mutationOptions (see hooks/use-idempotency-key.ts).",
});
```

## When not to use it

If the key is generated server-side or by a client interceptor on every mutation, no call site can
forget it.
