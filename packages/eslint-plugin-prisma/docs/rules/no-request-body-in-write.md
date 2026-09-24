# `noctcore-prisma/no-request-body-in-write`

> A Prisma write must not take its `data` or `where` straight from the request body.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`prisma.user.update({ where: { id }, data: req.body })` lets the caller set every column the model
has, not just the three the form shows: `role`, `isAdmin`, `tenantId`, `emailVerified`, or a relation
`connect` that attaches a row they do not own. This is mass assignment
([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html)), and it
passes type checking because the body is `any`, or is cast to the create input on the way in.

A request body used as a `where` is the sibling problem. The caller can send operators instead of
values (`{ email: { not: '' } }`) and widen an `updateMany` or `deleteMany` to rows the handler never
meant, the same class as Mongoose's `sanitizeFilter` bypasses.

## What it flags

A Prisma write (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, ... every write
method) whose first argument's payload is client input:

- `data`, and an `upsert`'s `create` and `update`: the value itself, a spread inside it, an element or
  spread of a `createMany` array, and nested relation writes (`profile: { create: ... }`);
- `where`: the value itself, or a top-level spread in it.

```ts bad reports=4
await prisma.user.update({ where: { id }, data: req.body });
await prisma.post.create({ data: { ...req.body, authorId: session.userId } });
await prisma.user.create({ data: { name, profile: { create: req.body.profile } } });
await prisma.user.deleteMany({ where: req.body });
```

```ts good
await prisma.user.update({ where: { id }, data: UpdateUser.parse(req.body) });
await prisma.post.create({ data: { title: req.body.title, body: req.body.body, authorId: session.userId } });
await prisma.user.create({ data: { name, profile: { create: Profile.parse(req.body.profile) } } });
await prisma.user.deleteMany({ where: { id: { in: DeleteUsers.parse(req.body).ids } } });
```

Client input is one of the `sources` paths (default: `req.body`, `request.body`, `ctx.request.body`,
`req.query`, and the calls `req.json()`, `request.json()`, `c.req.json()`, `c.req.parseBody()`), or a
member access below one (`req.body.user`). The rule follows it through a `const` binding, a
destructure (`const { body } = req`), `as` / `satisfies` / `!` / `await`, either branch of `?:` /
`??` / `||`, and `Object.fromEntries` over a `FormData`:

```ts bad reports=3
export async function POST(request: Request) {
  const body = await request.json();
  await prisma.user.create({ data: body });
}

export async function createUser(formData: FormData) {
  await prisma.user.create({ data: Object.fromEntries(formData) });
}

app.post('/users', async (c) => {
  await prisma.user.create({ data: (await c.req.json()) as Prisma.UserCreateInput });
});
```

```ts good
export async function POST(request: Request) {
  const body = CreateUser.parse(await request.json());
  await prisma.user.create({ data: body });
}

export async function createUser(formData: FormData) {
  await prisma.user.create({ data: CreateUser.parse(Object.fromEntries(formData)) });
}

app.post('/users', async (c) => {
  await prisma.user.create({ data: c.req.valid('json') });
});
```

It does not flag a value parsed first (`Schema.parse(req.body)`, `.safeParse(...).data`), fields picked
one by one (`{ name: body.name }`), a spread of a value it cannot trace to a source, or client data
stored in a JSON column (`{ payload: req.body }`), which assigns one column, not many.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sources` | `string[]` | see above | Dotted paths that hold raw client input. A path ending in `()` is a call (`readBody()`); any other path is a member access and covers everything below it. Replaces the default list. |

```ts bad options={"sources":["event.body","readBody()"]}
await prisma.user.create({ data: await readBody(event) });
```

```ts good
await prisma.user.create({ data: CreateUser.parse(await readBody(event)) });
```

## Limits

The sources are spellings, not types. Input that reaches the write under another name (a NestJS
`@Body() dto`, an Elysia `({ body })` parameter, a helper's return value) is not traced; add its path to
`sources` if your framework has one. A `let` binding is not followed, since it may have been
reassigned to a sanitized value. Reads (`findMany({ where: req.query })`) are out of scope, and a
`where` is only inspected at its top level, not inside `AND` / `OR` arms. If validation middleware
replaces `req.body` with the parsed value in place, the rule still reports it: pass the parsed value
to the write instead of reading it back off the request.
