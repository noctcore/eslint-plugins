import { ruleTester } from '@noctcore/eslint-test-utils';

import { noRequestBodyInWriteRule } from '../../src/rules/no-request-body-in-write';

ruleTester.run('no-request-body-in-write', noRequestBodyInWriteRule, {
  valid: [
    // Parsed through a schema first.
    `prisma.user.create({ data: CreateUser.parse(req.body) });`,
    `prisma.user.create({ data: CreateUser.safeParse(req.body).data });`,
    `const input = CreateUser.parse(await request.json()); await prisma.user.create({ data: input });`,
    `const input = CreateUser.parse(req.body); await prisma.user.update({ where: { id }, data: { ...input } });`,
    // Explicit field picks, from the body directly or from a local copy.
    `prisma.user.create({ data: { name: req.body.name, email: req.body.email } });`,
    `const body = req.body; await prisma.user.create({ data: { name: body.name } });`,
    `const { name, email } = req.body; await prisma.user.create({ data: { name, email } });`,
    // A JSON column holding client data is not a column assignment.
    `prisma.event.create({ data: { kind: 'x', payload: req.body } });`,
    // Spreads of values the rule cannot trace to a source.
    `prisma.user.create({ data: { ...defaults, name } });`,
    `prisma.user.update({ where: { id }, data: { ...dto } });`,
    // `let` can be reassigned by a sanitizer, so it is not followed.
    `let body = req.body; body = sanitize(body); await prisma.user.create({ data: body });`,
    // Not a write: reads are out of scope.
    `prisma.user.findMany({ where: req.query });`,
    // A `where` built from named, parsed fields.
    `prisma.user.updateMany({ where: { id: req.params.id }, data: { active: false } });`,
    // Validated Hono input is not a raw source.
    `prisma.user.create({ data: c.req.valid('json') });`,
    // Similar names that are not the configured paths.
    `prisma.user.create({ data: request.bodyUsed });`,
    `prisma.user.create({ data: this.req.body });`,
    // A payload that is not an object literal argument is not inspected.
    `prisma.user.create(args);`,
    // FormData entries picked one by one.
    `const form = await request.formData(); await prisma.user.create({ data: { name: String(form.get('name')) } });`,
    // Object.fromEntries over server-built pairs.
    `prisma.setting.create({ data: Object.fromEntries(defaults) });`,
    // A computed method name is not matched.
    `prisma.user[method]({ data: req.body });`,
    // Replaced sources: the defaults no longer apply.
    {
      code: `prisma.user.create({ data: req.body });`,
      options: [{ sources: ['event.body'] }],
    },
  ],
  invalid: [
    // The canonical mass assignment.
    {
      code: `prisma.user.create({ data: req.body });`,
      errors: [{ messageId: 'clientInputInWrite', data: { key: 'data', source: 'req.body' } }],
    },
    // Cast to the create input: still unvalidated.
    {
      code: `prisma.user.update({ where: { id }, data: req.body as Prisma.UserUpdateInput });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // A sub-object of the body.
    {
      code: `prisma.user.create({ data: request.body.user });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Spread with a server field added on top.
    {
      code: `prisma.post.create({ data: { ...req.body, authorId: session.userId } });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Fetch-style body, awaited.
    {
      code: `export async function POST(request) { await prisma.user.create({ data: await request.json() }); }`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Through a same-function const.
    {
      code: `const body = await req.json(); await db.user.update({ where: { id }, data: body });`,
      errors: [{ messageId: 'clientInputInWrite', data: { key: 'data', source: 'body' } }],
    },
    // Shorthand `data` bound to an object that spreads the body.
    {
      code: `const data = { ...req.body, ownerId }; await prisma.item.create({ data });`,
      errors: [{ messageId: 'clientInputInWrite', data: { key: 'data', source: 'req.body' } }],
    },
    // Destructured out of the request.
    {
      code: `const { body } = req; await prisma.user.create({ data: body });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Koa.
    {
      code: `await prisma.user.create({ data: ctx.request.body });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Hono.
    {
      code: `await prisma.user.create({ data: await c.req.json() });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `await prisma.user.create({ data: await c.req.parseBody() });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // FormData flattened into a payload.
    {
      code: `await prisma.user.create({ data: Object.fromEntries(await request.formData()) });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `async function action(formData: FormData) { await prisma.user.create({ data: Object.fromEntries(formData) }); }`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `const form = await request.formData(); const fields = Object.fromEntries(form); await prisma.user.create({ data: { ...fields } });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // upsert payloads.
    {
      code: `prisma.user.upsert({ where: { id }, create: req.body, update: req.body });`,
      errors: [
        { messageId: 'clientInputInWrite', data: { key: 'create', source: 'req.body' } },
        { messageId: 'clientInputInWrite', data: { key: 'update', source: 'req.body' } },
      ],
    },
    // createMany over a client array, directly or spread.
    {
      code: `prisma.item.createMany({ data: req.body.items });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `prisma.item.createMany({ data: [...req.body.items, seed] });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `prisma.item.createManyAndReturn({ data: [{ ...req.body }] });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Nested relation writes.
    {
      code: `prisma.user.create({ data: { name, profile: { create: req.body.profile } } });`,
      errors: [{ messageId: 'clientInputInWrite', data: { key: 'create', source: 'req.body.profile' } }],
    },
    {
      code: `prisma.user.update({ where: { id }, data: { posts: { upsert: { where: { id: pid }, create: { ...req.body }, update: { title } } } } });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `prisma.user.create({ data: { posts: { createMany: { data: req.body.posts } } } });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Either branch of a fallback.
    {
      code: `prisma.user.update({ where: { id }, data: req.body ?? {} });`,
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    // Filter injection on a write.
    {
      code: `prisma.user.deleteMany({ where: req.body });`,
      errors: [{ messageId: 'clientInputInWhere', data: { key: 'where', source: 'req.body' } }],
    },
    {
      code: `prisma.user.updateMany({ where: { ...req.query, orgId }, data: { active: false } });`,
      errors: [{ messageId: 'clientInputInWhere', data: { key: 'where', source: 'req.query' } }],
    },
    // Custom sources.
    {
      code: `prisma.user.create({ data: event.body });`,
      options: [{ sources: ['event.body'] }],
      errors: [{ messageId: 'clientInputInWrite' }],
    },
    {
      code: `prisma.user.create({ data: await readBody(event) });`,
      options: [{ sources: ['readBody()'] }],
      errors: [{ messageId: 'clientInputInWrite' }],
    },
  ],
});
