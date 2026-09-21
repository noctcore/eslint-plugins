import { ruleTester } from '@noctcore/eslint-test-utils';

import { prismaWriteInTransactionRule } from '../../src/rules/prisma-write-in-transaction';

ruleTester.run('prisma-write-in-transaction', prismaWriteInTransactionRule, {
  valid: [
    // A single write alone is safe; nothing to coordinate.
    {
      code: `
        class InvoiceService {
          async createInvoice() {
            await this.prisma.client.invoice.create({ data: {} });
          }
        }
      `,
    },
    // Two writes both inside one interactive `$transaction(async (tx) => {...})`.
    {
      code: `
        class InvoiceService {
          async createInvoice() {
            await this.prisma.client.$transaction(async (tx) => {
              await tx.invoice.create({ data: {} });
              await tx.invoiceLine.createMany({ data: [] });
            });
          }
        }
      `,
    },
    // Array form: the writes are arguments to `$transaction` and must not be flagged.
    {
      code: `
        async function run() {
          await prisma.$transaction([
            prisma.invoice.create({ data: {} }),
            prisma.invoiceLine.createMany({ data: [] }),
          ]);
        }
      `,
    },
    // Writes split across two separate methods: one each, neither reaches the threshold.
    {
      code: `
        class InvoiceService {
          async a() {
            await this.prisma.client.invoice.create({ data: {} });
          }
          async b() {
            await this.prisma.client.invoiceLine.createMany({ data: [] });
          }
        }
      `,
    },
    // The BaseRepository `this.client` idiom: a single write per method is safe,
    // matching the one-write-per-repository-method convention.
    {
      code: `
        class TokenRepository {
          async create() {
            await this.client.token.create({ data: {} });
          }
        }
      `,
    },
    // Two `this.client` writes wrapped in a $transaction are coordinated: not flagged.
    {
      code: `
        class TokenRepository {
          async rotate() {
            await this.client.$transaction(async (tx) => {
              await tx.token.delete({ where: {} });
              await tx.token.create({ data: {} });
            });
          }
        }
      `,
    },
    // `this.client` is not a Prisma client by default: two SDK calls through an
    // unrelated client are not Prisma writes.
    {
      code: `
        class Mailer {
          async send() {
            await this.client.messages.create({ body: 'a' });
            await this.client.messages.create({ body: 'b' });
          }
        }
      `,
    },
    // receiverPattern: under a custom pattern, `prisma` no longer names a client.
    {
      code: `
        async function run() {
          await prisma.invoice.create({ data: {} });
          await prisma.invoiceLine.create({ data: {} });
        }
      `,
      options: [{ receiverPattern: '^db$' }],
    },
    // txRootNames: replacing the default drops `tx`.
    {
      code: `
        async function run(tx) {
          await tx.invoice.create({ data: {} });
          await tx.invoiceLine.create({ data: {} });
        }
      `,
      options: [{ txRootNames: ['trx'] }],
    },
    // thresholdWrites: two writes stay under a threshold of three.
    {
      code: `
        async function run() {
          await prisma.invoice.create({ data: {} });
          await prisma.invoiceLine.create({ data: {} });
        }
      `,
      options: [{ thresholdWrites: 3 }],
    },
  ],
  invalid: [
    // Two awaited writes directly in a method with no `$transaction`.
    {
      code: `
        class InvoiceService {
          async createInvoice() {
            await this.prisma.client.invoice.create({ data: {} });
            await this.prisma.client.invoiceLine.createMany({ data: [] });
          }
        }
      `,
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // Two repository-base-class `this.client` writes in one method (no
    // $transaction) are flagged once `client` is a configured client property.
    {
      options: [{ clientProperties: ['client'] }],
      code: `
        class TokenRepository {
          async replace() {
            await this.client.token.delete({ where: {} });
            await this.client.token.create({ data: {} });
          }
        }
      `,
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // The *AndReturn writes count as writes: a pair of them outside a
    // $transaction is the same split-brain risk as any other pair.
    {
      code: `
        class InvoiceService {
          async createInvoice() {
            await this.prisma.client.invoice.createManyAndReturn({ data: [] });
            await this.prisma.client.invoiceLine.updateManyAndReturn({ where: {}, data: {} });
          }
        }
      `,
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // receiverPattern: a project whose client is `db`.
    {
      code: `
        async function run() {
          await db.invoice.create({ data: {} });
          await db.invoiceLine.create({ data: {} });
        }
      `,
      options: [{ receiverPattern: '^db$' }],
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // txRootNames: the default `tx` is a Prisma client even when passed in as a
    // parameter rather than opened here.
    {
      code: `
        async function run(tx) {
          await tx.invoice.create({ data: {} });
          await tx.invoiceLine.create({ data: {} });
        }
      `,
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // txRootNames: a project that names its transaction client `trx`.
    {
      code: `
        async function run(trx) {
          await trx.invoice.create({ data: {} });
          await trx.invoiceLine.create({ data: {} });
        }
      `,
      options: [{ txRootNames: ['trx'] }],
      errors: [{ messageId: 'multiWriteNotTransactional' }],
    },
    // thresholdWrites: the third write is the one reported.
    {
      code: `
        async function run() {
          await prisma.invoice.create({ data: {} });
          await prisma.invoiceLine.create({ data: {} });
          await prisma.invoiceNote.create({ data: {} });
        }
      `,
      options: [{ thresholdWrites: 3 }],
      errors: [{ messageId: 'multiWriteNotTransactional', line: 5 }],
    },
  ],
});
