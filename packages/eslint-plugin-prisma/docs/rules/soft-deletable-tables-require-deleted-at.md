# `noctcore-prisma/soft-deletable-tables-require-deleted-at`

> A filtered read or bulk write on a soft-deletable model must exclude soft-deleted rows in its
> `where`.

<!-- begin generated rule header -->
⚙️ Opt-in: not in `recommended`; needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A soft-deleted row survives its delete and is hidden by a `deletedAt: null` filter. Unlike a tenant
boundary, nothing usually injects that filter: it is a convention, so a query that forgets it reads
or mutates deleted rows while every type and test still passes. The classic defect is a lookup that
resolves an account without excluding a deleted one and hands data to a user whose access was
revoked.

## What it flags

A filtered read (`findMany`, `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`) or a
filtered bulk write (`updateMany`, `updateManyAndReturn`, `deleteMany`) on a model in
`softDeleteModels`, on **any** client, when the query provably carries no soft-delete filter:

- the `where` never mentions `deletedAtField` at any depth (`AND`, `OR`, `NOT` and relation filters
  are walked) and spreads none of `softDeleteSpreads`; or
- there is no `where` at all (`user.count()`, `user.findMany({ select })`).

One hop of binding resolution is done, so `const where = { tenantId, ...this.notDeleted }` then
`findMany({ where })` is read correctly, as is a resolvable spread at the argument level.

```ts bad reports=2 options={"softDeleteModels":["user"],"softDeleteSpreads":["notDeleted"]}
// with { softDeleteModels: ['user'], softDeleteSpreads: ['notDeleted'] }
await this.prisma.user.findFirst({ where: { email } });
await this.prisma.user.count();
```

```ts good options={"softDeleteModels":["user"],"softDeleteSpreads":["notDeleted"]}
await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
await this.prisma.user.findFirst({ where: { email, ...this.notDeleted } });
```

Deliberately **not** reported:

- `findUnique`, `findUniqueOrThrow`, `update`, `delete`, `upsert`: their `where` is a unique
  selector. They are not harmless (`findUnique({ where: { id } })` does return a soft-deleted row),
  so review those sites by hand; this rule does not claim them.
- an opaque `where` or argument object (`findMany({ where: buildWhere() })`, `findMany(args)`):
  nothing to read, so nothing is claimed.

An **unresolvable spread** (`{ id, ...this.somethingElse }`) is not an excuse and is reported:
otherwise any spread would silence the rule. A helper that does carry the filter belongs in
`softDeleteSpreads`.

A mention anywhere in the tree counts, including through a relation (`{ owner: { deletedAt: null }
}`). The rule asks whether soft delete was considered at the call site; proving the mention
constrains the right model would need type information.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `softDeleteModels` | `string[]` | `[]` | Delegate accessors carrying the soft-delete column. Nothing is guessed: with none, the rule reports nothing. |
| `deletedAtField` | `string` | `'deletedAt'` | The soft-delete column a guarded `where` must mention. |
| `softDeleteSpreads` | `string[]` | `[]` | Names of a shared filter helper recognised when spread into a `where` (`...notDeleted`, `...this.notDeleted`). |
| `allowIn` | `string[]` (globs) | `[]` | Files not policed, e.g. a purge job whose subject IS the deleted rows. |
| `allowInFunctions` | `{ files: string[]; functions: string[] }[]` | `[]` | Functions not policed, in the files their globs match. Every other call in those files still is. |

Prefer `allowInFunctions` to `allowIn` when the omission is one query's judgement rather than the
file's. `allowIn` exempts the whole file, so a compliant query beside the exempt one can later drop
its filter without the rule noticing. A call belongs to its nearest named enclosing function (a
class method, a function declaration, or a function bound to a variable or object key). Anonymous
callbacks are looked through, so a count inside `Promise.all([...])` still belongs to the method
around it, while a named helper declared inside an exempt function is policed as its own function.

```js
allowInFunctions: [
  {
    files: ['**/modules/auth/staff-invite/staff-invite.repository.ts'],
    functions: ['countAllUsersInTenant'],
  },
],
```

`softDeleteSpreads` decides whether the rule is usable in a codebase with a helper convention: a
rule blind to the spread reports correct code more often than defects, and gets turned off.
