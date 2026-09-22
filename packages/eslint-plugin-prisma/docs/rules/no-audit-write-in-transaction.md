# `noctcore-prisma/no-audit-write-in-transaction`

> Do not write the audit log inside a `$transaction` callback. Audit after the commit.

## What this rule does NOT do

**It does not check that mutations are audited.** A service method that writes and never calls the
audit logger passes this rule. It only polices WHERE an audit write sits, never WHETHER one exists.

It was moved from a consumer where it was named `mutating-service-must-audit`. That name promised
the missing check, and the consumer's own docs and comments came to rely on it: one service comment
records that the rule "stayed green" on a mutation with no audit row at all. It is renamed for what
it does. If you need "every mutation is audited", that is a different rule, and this is not it: see
[`mutation-entry-must-reach-audit`](./mutation-entry-must-reach-audit.md), and read its limits.

## Why

An audit write inside a business transaction is rolled back with it. When the operation fails, the
evidence that it was attempted disappears with the rows it tried to write. Writing the audit row
right after the commit keeps it.

## What it flags

A call to one of `auditMethods` on an audit logger (a bare identifier, or the last member of
`this.<name>` / `x.<name>`, whose name matches `auditReceiverPattern`), when the call sits anywhere
inside a function passed to `<anything>.$transaction(...)`, including callbacks nested inside it
(`rows.forEach(...)`).

```ts bad
await this.prisma.$transaction(async (tx) => {
  await tx.invoice.update({ where: { id }, data });
  await this.auditService.log({ action: 'invoice.updated', targetId: id });
});
```

```ts good
await this.prisma.$transaction(async (tx) => {
  await tx.invoice.update({ where: { id }, data });
});
await this.auditService.log({ action: 'invoice.updated', targetId: id });
```

A `.log()` on a receiver that does not match (`this.logger.log`) is never reported. The array form
`$transaction([...])` holds no callback and is not inspected.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `auditReceiverPattern` | `string` (regex source) | `'audit'` | An audit logger's name must match this (case-insensitive): `auditService`, `this.audit`, `auditLog`. |
| `auditMethods` | `string[]` (1+) | `['log']` | Methods on the audit logger that write an audit row. |

## When not to use it

If your audit trail is deliberately transactional (the audit row must exist if and only if the
business write committed, and a failed attempt is not something you record), this rule's premise
does not hold for you. Note that an audit row written with `tx.auditLog.create(...)` is not an
audit-logger call and is not reported either way.

## Limits

Name and shape matching with no type information. An audit logger reached through a differently
named binding, or a transaction opened through a wrapper that does not spell `$transaction`, is not
seen.
