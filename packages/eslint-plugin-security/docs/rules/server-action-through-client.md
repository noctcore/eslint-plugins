# `noctcore-security/server-action-through-client`

> In a `'use server'` module, every exported action must be built from a configured action client, and no raw `export async function` may appear. Opt-in: needs `actionClients`.

<!-- begin generated rule header -->
⚙️ Opt-in: not in `recommended`; needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A module whose first statement is `'use server'` turns every export into a public POST endpoint.
The Next.js docs say to treat one "with the same security considerations as public-facing API
endpoints". An action client (`createSafeActionClient` in next-safe-action, `createServerFn` in
TanStack Start) is where input validation, error shaping and middleware live, and auth middleware
is one of those. A raw `export async function` has none of that: whatever the caller posts reaches
the body as-is, errors leak as they are thrown, and no middleware runs.

This rule does **not** decide which client is right. A public contact form built from an
`unauthenticatedAction` client, defended by a rate limit and a bot check, is correct code, and a
rule that reports it is a rule people turn off. The invariant here is the weaker, true one: every
exported action goes through a client the project has named, so the choice of client is written
at the definition site, where a reviewer reads `unauthenticatedAction` and asks whether that was
intended.

## What it flags

In a module whose **first statement** is the `'use server'` directive:

- any exported function declaration, `export async function` or `export default async function`,
  async or not;
- any exported binding whose initializer is a function or arrow expression;
- any exported binding whose initializer is a call chain that does not start at a name in
  `actionClients`, however long the chain.

A chain starts at a client when its innermost call's callee is the client or a member of it:
`unauthenticatedAction.metadata(...).inputSchema(...).action(...)` starts at `unauthenticatedAction`,
and `createServerFn({ method: 'POST' }).handler(...)` starts at `createServerFn`. A dotted option
value such as `clients.auth` matches a chain written `clients.auth.action(...)`.

```ts bad options={"actionClients":["authActionClient"]}
'use server';

import { db } from '@/lib/db';

// a public endpoint with no input schema, no error policy and no middleware
export async function deleteUser(userId: string) {
  await db.user.delete({ where: { id: userId } });
}
```

```ts good options={"actionClients":["authActionClient"]}
'use server';

import { z } from 'zod';
import { db } from '@/lib/db';
import { authActionClient } from '@/lib/safe-action';

// input validated, errors shaped, and the client's middleware (auth included) runs first
export const deleteUser = authActionClient
  .inputSchema(z.object({ userId: z.string() }))
  .action(async ({ parsedInput }) => {
    await db.user.delete({ where: { id: parsedInput.userId } });
  });
```

A chain that starts somewhere other than a configured client is reported too. That covers a
client the config does not know about, and a wrapper around a client-built action, because the
wrapper is what the chain starts at.

```ts bad options={"actionClients":["authActionClient"]}
'use server';

import { legacyClient } from '@/lib/legacy';

// `legacyClient` is not in `actionClients`
export const archive = legacyClient.inputSchema(schema).action(async () => {});
```

```ts good options={"actionClients":["authActionClient"]}
'use server';

import { authActionClient } from '@/lib/safe-action';

export const archive = authActionClient.inputSchema(schema).action(async () => {});
```

### Inline actions

An inline action is a function whose body opens with `'use server'`, written inside a server
component. It cannot be built from a client, so it has no input schema, error policy or
middleware. By default the rule reports it, in any module; set `allowInline: true` to accept them.
In a module that already carries the `'use server'` directive, a body directive is redundant and
the export checks above apply instead.

```tsx bad filename=src/app/page.tsx options={"actionClients":["authActionClient"]}
import { db } from '@/lib/db';

export default function Page() {
  async function create(formData: FormData) {
    'use server';
    await db.post.create({ data: { title: String(formData.get('title')) } });
  }
  return (
    <form action={create}>
      <button>Create</button>
    </form>
  );
}
```

```tsx good filename=src/app/page.tsx options={"actionClients":["authActionClient"],"allowInline":true} reconfigured
import { db } from '@/lib/db';

// the project has decided inline actions are acceptable
export default function Page() {
  async function create(formData: FormData) {
    'use server';
    await db.post.create({ data: { title: String(formData.get('title')) } });
  }
  return (
    <form action={create}>
      <button>Create</button>
    </form>
  );
}
```

The fix that keeps the default is to move the action into a `'use server'` module and build it from
a client there, then import it into the page.

### What it does not flag

- Exported values that are not functions: a constant, a type, an interface, a class, a re-export
  (`export { x } from './x'`, `export * from './x'`).
- A function that is not exported. It is not reachable from the client.
- Anything in a module without the directive as its first statement. `'use server'` after an
  import is not the module directive, and a `'use client'` module is not a server module.
- A chain that starts at a configured client, however long, and through `as`, `satisfies`, `!`
  or optional chaining.

```ts good options={"actionClients":["authActionClient"]}
'use server';

import { authActionClient } from '@/lib/safe-action';

export const LIMIT = 5;
export type Input = { userId: string };
export { formatUser } from './format';

async function audit(userId: string) {}

export const deleteUser = authActionClient
  .use(loggingMiddleware)
  .metadata({ actionName: 'deleteUser' })
  .inputSchema(schema)
  .action(async ({ parsedInput }) => audit(parsedInput.userId));
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `actionClients` | `string[]` | `[]` | Identifiers (dotted allowed) a server action's chain must start at. Required in practice. |
| `allowInline` | `boolean` | `false` | Accept functions whose body opens with `'use server'` outside a server module. |

With an empty `actionClients` no name is a client, so **every** exported action in a server module
is reported. That is deliberate: a misconfigured security rule should be loud, not silent. Name
every client the project builds actions from, including the public one.

```js
'noctcore-security/server-action-through-client': ['error', {
  actionClients: ['actionClient', 'authActionClient', 'unauthenticatedAction'],
}]
```

## Severity

Ships **off** and is left out of `recommended`. Client names are a per-project fact with no
universal default, and with none configured the rule reports every action, so a shared preset
cannot turn it on for a stranger's repo. Once configured, `error`: every report is an action that
bypasses the project's own pipeline.

## When not to use it

A project with no action client, where every server action is a raw function by choice, has
nothing for this rule to check and should leave it off. A project that names only its public
client has decided that every action may be public; the rule enforces that decision and nothing
stronger.
