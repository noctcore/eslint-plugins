# `noctcore-prisma/restrict-model-writes`

> Only the files that own a model may write it, or write the columns you name on it. Nested relation
> writes included.

<!-- begin generated rule header -->
⚙️ Opt-in: not in `recommended`; needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Some rows are only correct when one service writes them. It keeps a derived column in step, writes
the side rows that go with the change (a ledger entry, an audit row), or moves a status by
compare-and-swap. A router, a job or a well-meaning bug fix calling `prisma.invoice.update(...)`
directly satisfies the type checker, passes every test, and quietly leaves those invariants lying.

## What it flags

Each entry in `restrictions` is one fence, checked in every file its `allowedFiles` does not cover.

**Model-scoped fence** (no `fields`): any `create`, `createMany`, `createManyAndReturn`, `update`,
`updateMany`, `updateManyAndReturn`, `upsert`, `delete` or `deleteMany` on a guarded model. Reads are
never reported.

**Field-scoped fence** (`fields` set): the rule must *prove* a fenced column is not written, so it
reports

- a create/update/upsert payload that sets a fenced column (every element of a `createMany` list,
  both halves of an `upsert`);
- a payload it cannot read: a spread (`data: { ...changes }`), a variable (`data`, `update(args)`),
  a computed key (`{ [column]: v }`), or an argument with no payload key;
- every `delete` / `deleteMany`, zero arguments included: removing the row writes every column at
  once;
- a nested write through a relation the guarded model declares to itself or to another guarded
  model (`invoice.update({ data: { supersedes: { update: ... } } })`).

**Both kinds** report a nested write that reaches a guarded model from a write on some other model,
whatever it carries. A nested write cannot compare-and-swap (its `where` is scoped to the parent and
it returns no row count), so there is no safe one from outside the owner. The relation keys are
derived from your Prisma schema (`schemaPath`), so `issuedInvoices`, `supersededBy` and any relation
added by a later migration are covered without a config edit. Only relation keys holding a nested
write verb (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`,
`connectOrCreate`) count; `connect`, `disconnect`, `set`, relation filters and `include` do not.

```ts bad reports=5 filename=src/billing/billing.router.ts options={"restrictions":[{"models":["payment"],"allowedFiles":["**/billing/payment.service.ts"],"owner":"PaymentService"},{"models":["invoice"],"fields":["status"],"allowedFiles":["**/billing/invoice-lifecycle.service.ts"],"owner":"InvoiceLifecycleService"}]}
// restrictions: [
//   { models: ['payment'], allowedFiles: ['**/billing/payment.service.ts'], owner: 'PaymentService' },
//   { models: ['invoice'], fields: ['status'], allowedFiles: ['**/billing/invoice-lifecycle.service.ts'],
//     owner: 'InvoiceLifecycleService' },
// ]
await tx.payment.create({ data: { invoiceId, amount } });
await tx.invoice.update({ where: { id }, data: { status: 'PAID' } });
await tx.invoice.update({ where: { id }, data: { ...changes } }); // cannot prove status is absent
await tx.invoice.delete({ where: { id } });
await tx.customer.update({ where: { id }, data: { invoices: { create: { total } } } });
```

```ts good filename=src/billing/billing.router.ts options={"restrictions":[{"models":["payment"],"allowedFiles":["**/billing/payment.service.ts"],"owner":"PaymentService"},{"models":["invoice"],"fields":["status"],"allowedFiles":["**/billing/invoice-lifecycle.service.ts"],"owner":"InvoiceLifecycleService"}]}
await tx.invoice.update({ where: { id }, data: { dueAt } }); // not a fenced column
await tx.payment.findMany({ where: { invoiceId } }); // reads are never fenced
await this.invoiceLifecycle.markPaid(id); // the owner does it
```

## What it does not flag

Reads are never reported. Under a field-scoped fence, a write that touches only other columns is not
reported. `connect`, `disconnect`, `set`, relation filters and `include` are not nested writes.

**It does not check state transitions.** This rule decides WHO may write a model and, with
`fields`, WHICH COLUMNS are fenced. It knows nothing about which values are legal or which
`from -> to` moves are allowed. A write from inside `allowedFiles` that moves a status from any
value to any other passes, and so does a write outside them that sets no fenced column.

Transition legality belongs in the owning service, typically as a compare-and-swap (`update({ where:
{ id, status: 'ISSUED' }, data: { status: 'PAID' } })`, so a concurrent writer updates zero rows and
loses). This rule's job is to make that service the only way in. If you need transitions enforced,
enforce them there and test them there; do not read this rule as having done it.

Name and shape matching with no type information, keyed on `<anything>.<model>.<method>(`:

- An aliased delegate (`const d = tx.invoice; d.update(...)`) is not caught. It is rare and reads as
  deliberate evasion.
- A nested write inside a variable payload on another model (`customer.update({ where, data })`) is
  not caught: there is no object literal to walk, and reporting every opaque payload on every model
  would bury the real findings. A direct write keys on the accessor, so `invoice.update(payload)`
  is still caught.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `restrictions` | `[]` | The fences. Each is independent: the owner of one fence is outside every other. |
| `restrictions[].models` | required | Prisma delegate accessors the fence guards (`invoice`, not `Invoice`). |
| `restrictions[].allowedFiles` | required | Globs of the files that may write. Nothing is implicit: list the owner, its repository, their specs, and your seeds and migrations. Matched against the absolute and the workspace-root-relative path. |
| `restrictions[].fields` | omitted | Scope the fence to these columns. Omitted, every write to the model is fenced. |
| `restrictions[].relations` | `[]` | Relation keys added to the schema-derived ones. |
| `restrictions[].owner` | `'the files allowed to write it'` | Who owns the writes, named in every message. |
| `restrictions[].reason` | none | One sentence appended to every message. |
| `schemaPath` | `'prisma/schema.prisma'` | Where the relation names are derived from: absolute, or relative to the workspace root. A `prismaSchemaFolder` directory works. |

```js
'noctcore-prisma/restrict-model-writes': ['error', {
  restrictions: [
    { models: ['payment'], allowedFiles: ['**/billing/payment.service.ts'], owner: 'PaymentService' },
    {
      models: ['invoice'],
      fields: ['status'],
      allowedFiles: ['**/billing/invoice-lifecycle.service.ts', '**/billing/invoice-lifecycle.service.spec.ts'],
      owner: 'InvoiceLifecycleService',
      reason: 'status moves by compare-and-swap',
    },
  ],
}],
```

The full options type:

```ts prose reason="the options type, not a lint example"
{
  restrictions?: Array<{
    models: string[];        // delegate accessors, e.g. ['invoice']. Required, 1+.
    allowedFiles: string[];  // globs of the files permitted to write them. Required.
    fields?: string[];       // omit: fence the whole model. Set: fence only these columns.
    relations?: string[];    // extra nested-write relation keys the schema cannot describe.
    owner?: string;          // named in messages, e.g. 'InvoiceLifecycleService'.
    reason?: string;         // appended to messages: the invariant the owner keeps.
  }>;                        // default: [] (the rule reports nothing).
  schemaPath?: string;       // default: 'prisma/schema.prisma'. A file or a schema folder.
}
```

Name owner files one by one rather than by directory. A directory glob's reach depends on what
lands beside the owner later, so a fence written as `**/billing/**` silently admits every new file in
the module.

If the schema cannot be read, nested detection falls back to the model name and its plural
(`invoice`, `invoices`) and self-relations are not checked. Keep a test in your project asserting the
schema is where `schemaPath` says, so a moved schema turns CI red instead of quietly narrowing the
fence.

## When not to use it

With no `restrictions` the rule reports nothing, so it only earns its place once a model has an
owning service that keeps an invariant. If any file may legitimately write a model, do not fence it.
