import { ruleTester } from '@noctcore/eslint-test-utils';

import { prismaTxUsesTxNotClientRule } from '../../src/rules/prisma-tx-uses-tx-not-client';

ruleTester.run('prisma-tx-uses-tx-not-client', prismaTxUsesTxNotClientRule, {
  valid: [
    // Write goes through the tx param.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await tx.invoice.create({ data }); });`,
    },
    // The same *AndReturn write through the tx param is fine.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await tx.invoiceLine.createManyAndReturn({ data }); });`,
    },
    // Deeper model access on the tx param is still rooted at `tx`.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await tx.account.createMany({ data }); });`,
    },
    // Query methods (findMany/count) on the outer client are not writes -> ignored.
    {
      code: `this.prisma.client.$transaction(async (tx) => { const rows = await this.prisma.client.account.findMany(); await tx.account.update({ where, data }); });`,
    },
    // Writes outside any transaction are not this rule's concern.
    {
      code: `await this.prisma.client.account.create({ data });`,
    },
    // Array form (no interactive callback) is not policed.
    {
      code: `this.prisma.client.$transaction([this.prisma.client.account.create({ data })]);`,
    },
    // Nested transactions each use their own tx param.
    {
      code: `tx.$transaction(async (tx2) => { await tx2.invoice.create({ data }); });`,
    },
    // A custom param name is honored.
    {
      code: `prisma.$transaction(async (trx) => { await trx.account.delete({ where }); });`,
    },
    // The BaseRepository `this.client` idiom OUTSIDE any transaction is not this
    // rule's concern.
    {
      code: `await this.client.account.create({ data });`,
    },
    // `this.client` is not a Prisma client by default: an SDK call inside the
    // callback is not an escaped Prisma write.
    {
      code: `prisma.$transaction(async (tx) => { await this.client.messages.create({ body }); });`,
    },
    // A write-named method on something that is not a client is ignored.
    {
      code: `prisma.$transaction(async (tx) => { createHash('sha256').update(x); this.cache.delete(k); });`,
    },
    // receiverPattern: under a custom pattern, `prisma` no longer names a client.
    {
      code: `db.$transaction(async (tx) => { await prisma.account.create({ data }); });`,
      options: [{ receiverPattern: '^db$' }],
    },
  ],
  invalid: [
    // Outer client write inside the callback escapes rollback.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await this.prisma.client.invoiceLine.createMany({ data }); });`,
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // createManyAndReturn through the OUTER client escapes the rollback exactly
    // like createMany does.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await this.prisma.client.invoiceLine.createManyAndReturn({ data }); });`,
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // Bare outer-client identifier write inside the callback.
    {
      code: `prisma.$transaction(async (tx) => { await prisma.account.update({ where, data }); });`,
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // Two outer-client writes -> two reports.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await this.prisma.client.account.create({ data }); await this.prisma.client.invoice.delete({ where }); });`,
      errors: [{ messageId: 'mustUseTxParam' }, { messageId: 'mustUseTxParam' }],
    },
    // Nested: writing through the OUTER tx param instead of the inner one still escapes the inner tx.
    {
      code: `tx.$transaction(async (tx2) => { await tx.invoice.create({ data }); });`,
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // A repository base class's `this.client` used inside the callback escapes
    // the transaction the same as `this.prisma.client`, once `client` is a
    // configured client property.
    {
      code: `this.prisma.client.$transaction(async (tx) => { await this.client.account.create({ data }); });`,
      options: [{ clientProperties: ['client'] }],
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // receiverPattern: a project whose client is `db`.
    {
      code: `db.$transaction(async (tx) => { await db.account.create({ data }); });`,
      options: [{ receiverPattern: '^db$' }],
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // txRootNames: an outer transaction client named `trx`, received as a
    // parameter rather than opened by an enclosing callback here.
    {
      code: `function f(trx) { prisma.$transaction(async (tx) => { await trx.account.create({ data }); }); }`,
      options: [{ txRootNames: ['trx'] }],
      errors: [{ messageId: 'mustUseTxParam' }],
    },
    // With the default txRootNames, the same `tx` root is recognised.
    {
      code: `function f(tx) { prisma.$transaction(async (inner) => { await tx.account.create({ data }); }); }`,
      errors: [{ messageId: 'mustUseTxParam' }],
    },
  ],
});
