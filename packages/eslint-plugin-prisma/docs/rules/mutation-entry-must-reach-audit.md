# `noctcore-prisma/mutation-entry-must-reach-audit`

> A mutation entry point that can reach a Prisma write must also be able to reach an audit write.
> **Requires type information.**

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: required
<!-- end generated rule header -->

## Why

### Why the entry point, not every service method

The phrase "every mutating service method audits" reads well and does not hold. In a layered API the
audit row is written by the method that orchestrates the operation, and the helpers it calls (a
token service rotating a token, a lockout counter, a repository primitive) write without auditing
because their caller already does. Measured on a production NestJS + tRPC API, a same-class version
of the check considered 83 public service methods mutating and reported 24 as unaudited. By hand,
three of the 24 were mutations nothing audits and a fourth was unaudited from one of its two
callers. The other twenty were helpers whose callers audit, scheduled retention sweeps, a
documented exemption, a method with no production caller, and a write behind a flag. A rule that is
wrong five times in six gets disabled.

The entry point is where "this operation left a trail" has to hold, and it is where the walk has a
single, well-defined root.

### Why it needs type information

A per-file rule cannot see this. The entry is in a router, the audit in the service it calls, and the
write in a repository the service calls: three files. The type checker has already resolved every
one of those calls, including `this.repository.update(...)` through constructor injection and a
method inherited from a base class, so the rule walks the resolved declarations instead of guessing
from names. Linting without type information is an error, not a silent pass (see the enable
snippet under [Options](#options)).

### Measured on a production API

Default options plus `auditMethods: ['log', 'logOrThrow']`, over a NestJS + tRPC API of 297
production files. Linting cost was within noise of the same typed lint with no rule enabled: the
type program dominates.

| | Entries |
| --- | --- |
| `@Mutation()` entries | 80 |
| audit reachable | 58 |
| no Prisma write reachable | 4 |
| skipped: an unreadable edge (ports) | 11 |
| **reported** | **7** |

All 7 hand-checked:

| Reported | Verdict |
| --- | --- |
| 2 entries writing tour-progress rows | Correct, and a documented decision in that codebase not to audit them. `unauditedModels: ['tourProgress']`. |
| 1 invitation-state check | Over-approximation: the delete below it runs only behind a flag this entry never sets. `ignoreEntries`. |
| avatar update, 2 notification read markers, verification-email resend | Correct: each writes, and nothing on any path audits it. Whether those need a trail is the codebase's call. |

That codebase's motivating miss, a packet-creation service method that wrote a row with no audit
(since fixed), is **not** reachable from any `@Mutation()` there, so this rule would not have seen
it. With a procedure calling it added in a scratch copy and the audit removed, the rule reports it
through four files (router, facade service, packet service, repository); with the audit restored,
it passes.

## What it flags

For every method marked as a mutation entry point (by default, decorated `@Mutation()`), the rule
follows the calls the TypeScript checker resolved, across files, and reports the entry when all
three hold:

1. something the entry can reach performs a Prisma write,
2. nothing the entry can reach writes the audit log, and
3. the rule read the **whole** reachable call graph.

So a report means: *no path from this entry writes an audit row, and at least one path may write
data.* A clean result means one of: an audit write is reachable on **some** path, the entry never
reaches a Prisma write, or part of the graph was unreadable (see [Blind spots](#blind-spots)).

```ts prose reason="a typed rule that follows calls across three files, which needs a type-checked program"
// invoice.router.ts
@Mutation()
async rename(@Input() input: RenameInput) {
  return this.invoices.rename(input.id, input.name);   // ✗ reported here
}

// invoice.service.ts
async rename(id: string, name: string) {
  await this.repository.rename(id, name);               // no audit anywhere below the entry
}

// invoice.repository.ts
rename(id: string, name: string) {
  return this.client.invoice.update({ where: { id }, data: { name } });
}
```

The message names the write and the path to it:

```
`InvoiceRouter.rename` reaches a Prisma write (invoice.update at invoice.repository.ts:10,
via InvoiceRouter.rename -> InvoiceService.rename -> InvoiceRepository.rename) and no audit
write anywhere in its call graph.
```

It passes as soon as any reachable function audits, however deep:

```ts prose reason="a typed rule that follows calls across three files, which needs a type-checked program"
// invoice.service.ts
async rename(id: string, name: string) {
  await this.repository.rename(id, name);
  await this.recordRename(id);                          // ✓ private helper, two calls down
}
private async recordRename(id: string) {
  await this.auditService.log({ action: 'invoice.renamed', targetId: id });
}
```

**A Prisma write** is a call to a write method (`create`, `createMany`, `createManyAndReturn`,
`update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`) whose receiver
either looks like a Prisma client under the receiver options (`receiverPattern`, `clientProperties`,
`txRootNames`, including `(tx ?? this.client)` and `tx ? tx : this.client`) or resolves to a
generated `<Model>Delegate` type. The second test is what finds a repository base class's
`this.client` with no configuration.

**An audit write** is either a call to one of `auditMethods` on a receiver whose name matches
`auditReceiverPattern` (the same test `no-audit-write-in-transaction` uses), or a Prisma write to a
model in `auditModels` (`tx.auditLog.create(...)` written by a repository counts).

**The walk** starts at the entry's body and follows every call it contains, including the ones
inside callbacks written in place (`$transaction(async (tx) => ...)`, `rows.map(...)`), and a method
handed over as a value (`.then(this.finish)`). Recursion and cycles terminate.

## What it does not flag

The rule does **not** prove:

- that the audit runs on **every** path. An audit written only in an error branch satisfies the
  rule on the success path too;
- that the audit runs **after** the write succeeded, or describes **this** write;
- anything about a mutation no entry point reaches. A service method that nothing with an entry
  decorator calls is out of scope, however much it writes;
- anything about entries it could not fully read. Those are silently skipped, never reported.

### Blind spots

Each of these is a way the rule stays silent on an unaudited mutation, or, for the first, reports a
correct one. Read them before trusting a clean run.

- **The walk is path-insensitive.** It reports a write that is reachable, not one that runs. A read
  helper that deletes an expired row only when a flag is set is a write for every caller, including
  the one that never sets the flag. That caller is reported, and `ignoreEntries` is the escape.
- **Unreadable edges silence the entry.** A call into an interface or abstract method (a port), a
  function held in a parameter, an ambient `declare` in project source, or a value typed `any` has
  no body to read. The unread code might be the audit, so the entry is skipped, never reported. On
  the API measured above, 11 of 80 entries were skipped this way, all through ports.
- **Library code is assumed to neither write nor audit.** Anything resolved into a declaration file
  or `node_modules` is a leaf. An audit written by a queued job, an event listener, a NestJS
  interceptor or middleware, or a database trigger is invisible, and an entry relying on one is
  reported.
- **Raw SQL is not a write.** `$executeRaw` says in its text whether it writes, and the common one in
  a service layer is an advisory lock. A mutation done only in raw SQL is never reported.
- **Constructors and getters are not followed.** A write in a `new X()` constructor or a property
  getter is not seen.
- **Only decorated entries.** A mutation reached only from an undecorated method, a queue processor
  or a scheduled job is checked only if you add its decorator to `entryDecorators`. A mutation no
  entry reaches at all is never checked.
- **Reaching an audit is not auditing this write.** One `auditService.log(...)` anywhere below the
  entry satisfies it, whatever it records.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entryDecorators` | `string[]` (1+) | `['Mutation']` | Decorators that make a method (or an arrow-function property) an entry point. Matched by name: `@Mutation`, `@Mutation(...)`, `@trpc.Mutation(...)`. |
| `auditReceiverPattern` | `string` (regex source) | `'audit'` | An audit logger's name must match this (case-insensitive). |
| `auditMethods` | `string[]` (1+) | `['log']` | Methods on the audit logger that write an audit row. |
| `auditModels` | `string[]` | `['auditLog']` | Model delegates whose writes are the audit row itself. |
| `unauditedModels` | `string[]` | `[]` | Model delegates whose writes are deliberately not audited (read markers, UI state). A write to one does not count as a mutation. |
| `ignoreEntries` | `string[]` | `[]` | Entries never reported, spelled as the message spells them (`AuthRouter.inviteState`). For an entry whose write the walk over-approximates. |
| `maxDepth` | `integer` (1+) | `12` | Calls deeper than this below the entry stop the walk, and the entry is then not reported. |
| `receiverPattern`, `clientProperties`, `txRootNames` | | as the other rules | How a Prisma client is recognised by name. See `prisma-write-in-transaction`. |

Prefer `unauditedModels` to `ignoreEntries`: it states a policy about data ("tour progress is not
audited") that holds for every present and future entry, where an ignored entry stays ignored after
someone adds a real write below it.

Enable it with type information:

```js
{
  files: ['src/**/*.ts'],
  ignores: ['**/*.{spec,test}.ts'],
  languageOptions: { parserOptions: { projectService: true } },
  plugins: { 'noctcore-prisma': prisma },
  rules: {
    'noctcore-prisma/mutation-entry-must-reach-audit': ['error', {
      auditMethods: ['log', 'logOrThrow'],
      unauditedModels: ['tourProgress'],
    }],
  },
}
```

## When not to use it

If your audit trail is written outside the call graph (an interceptor, a trigger, a queue consumer),
this rule reports every entry and its premise does not hold for you. If you do not lint with type
information, it cannot run.

## Related

[`no-audit-write-in-transaction`](./no-audit-write-in-transaction.md) polices WHERE an audit write sits (not inside a `$transaction` callback). This one polices
WHETHER one is reachable at all. They are independent and meant to be used together.
