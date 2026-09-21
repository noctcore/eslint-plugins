import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';

import {
  type ModelWriteRestriction,
  restrictModelWritesRule,
} from '../../src/rules/restrict-model-writes';

const SCHEMA = fileURLToPath(new URL('../fixtures/billing-schema.prisma', import.meta.url));

const OUTSIDE = 'apps/api/src/billing/billing.router.ts';
const PAYMENT_OWNER = 'apps/api/src/billing/payment.service.ts';
const LIFECYCLE_OWNER = 'apps/api/src/billing/invoice-lifecycle.service.ts';

const SYSTEM = ['**/prisma/seed.ts', '**/prisma/migrations/**', '**/*.isolation.spec.ts'];

/** MODEL-scoped: every write to Payment belongs to PaymentService. */
const PAYMENTS: ModelWriteRestriction = {
  models: ['payment'],
  allowedFiles: ['**/billing/payment.service.ts', '**/billing/payment.service.spec.ts', ...SYSTEM],
  owner: 'PaymentService',
};

/** FIELD-scoped: only Invoice.status (and its alias) belongs to the lifecycle service. */
const INVOICE_STATUS: ModelWriteRestriction = {
  models: ['invoice'],
  fields: ['status', 'state'],
  allowedFiles: ['**/billing/invoice-lifecycle.service.ts', ...SYSTEM],
  owner: 'InvoiceLifecycleService',
  reason: 'It moves the status by compare-and-swap and writes the ledger entry.',
};

const opts = (...restrictions: ModelWriteRestriction[]) =>
  [{ restrictions, schemaPath: SCHEMA }] as const;

ruleTester.run('restrict-model-writes', restrictModelWritesRule, {
  valid: [
    // No fences by default: nothing is guarded until one is declared.
    { code: 'await tx.payment.create({ data });', filename: OUTSIDE },

    // --- MODEL-scoped ---
    {
      // The owner writes freely.
      code: 'await tx.payment.create({ data }); await tx.payment.deleteMany();',
      filename: PAYMENT_OWNER,
      options: opts(PAYMENTS),
    },
    {
      // Seeds are allowlisted by the fence's own list.
      code: 'await prisma.payment.createMany({ data: rows });',
      filename: 'packages/database/prisma/seed.ts',
      options: opts(PAYMENTS),
    },
    {
      // Reads from anywhere are fine.
      code: 'await this.prisma.payment.findMany({ where: { invoiceId } }); await tx.payment.count();',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },
    {
      // Other models are untouched.
      code: 'await tx.customer.update({ where: { id }, data: { name } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },
    {
      // Computed accessors do not match the shape.
      code: "await tx['payment'].create({ data });",
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },
    {
      // NEAR MISS: `connect` relinks an existing row; it is not a nested write verb.
      code: 'await tx.invoice.update({ where: { id }, data: { payments: { connect: { id } } } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },
    {
      // NEAR MISS: a relation in a WHERE filter, not a payload.
      code: 'await tx.invoice.updateMany({ where: { payments: { some: { id } } }, data: { note } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },
    {
      // NEAR MISS: a nested write to an unrelated relation.
      code: 'await tx.customer.update({ where: { id }, data: { notes: { create: { body } } } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
    },

    // --- FIELD-scoped ---
    {
      // Touching a column that is not fenced skips no invariant.
      code: 'await tx.invoice.update({ where: { id }, data: { dueAt } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // A create that lets the default status apply sets no guarded column.
      code: 'await tx.invoice.create({ data: { accountId, customerId } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // Reading by status is fine.
      code: 'await tx.invoice.findMany({ where: { status: "ISSUED" } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // The owner transitions freely. NOTE: legality of the transition is not
      // checked anywhere by this rule, only who performs it.
      code: 'await tx.invoice.update({ where: { id, status: "DRAFT" }, data: { status: "PAID" } });',
      filename: LIFECYCLE_OWNER,
      options: opts(INVOICE_STATUS),
    },
    {
      // A zero-arg call merely shares the name: no Prisma payload method takes none.
      code: 'await this.view.invoice.update();',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // NEAR MISS: a derived relation named in an include.
      code: 'await tx.account.update({ where: { id }, data: { name }, include: { issuedInvoices: true } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // Inside a payload on the guarded model, a key that is a relation to it
      // only on ANOTHER model (`invoices` lives on Account and Customer) is a
      // column here, not a nested write.
      code: 'await tx.invoice.update({ where: { id }, data: { invoices: { create: {} }, payments: { create: {} } } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
    {
      // With no schema the self-relations are unknown, so none is guessed.
      code: 'await tx.invoice.update({ where: { id }, data: { supersedes: { update: { data: { note } } } } });',
      filename: OUTSIDE,
      options: [{ restrictions: [INVOICE_STATUS], schemaPath: '/nonexistent/schema.prisma' }],
    },
    {
      // A field fence does not report a nested write inside a DELETE's argument:
      // deletes carry no payload.
      code: 'await tx.account.deleteMany({ where: { invoices: { create: {} } } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
    },
  ],
  invalid: [
    // --- MODEL-scoped ---
    {
      code: 'await tx.payment.create({ data: { invoiceId, amount } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
      errors: [
        {
          messageId: 'writeOutsideOwner',
          data: { model: 'payment', owner: 'PaymentService', reason: '' },
        },
      ],
    },
    {
      // Every write method, the *AndReturn variants and a bare deleteMany included.
      code: [
        'await tx.payment.createManyAndReturn({ data });',
        'await tx.payment.updateManyAndReturn({ where, data });',
        'await tx.payment.upsert({ where, create, update });',
        'await tx.payment.delete({ where });',
        'await tx.payment.deleteMany();',
      ].join('\n'),
      filename: OUTSIDE,
      options: opts(PAYMENTS),
      errors: Array.from({ length: 5 }, () => ({ messageId: 'writeOutsideOwner' as const })),
    },
    {
      // The payment service's spec is allowlisted; the router's spec is not.
      code: 'await tx.payment.update({ where, data });',
      filename: 'apps/api/src/billing/billing.router.spec.ts',
      options: opts(PAYMENTS),
      errors: [{ messageId: 'writeOutsideOwner' }],
    },
    {
      // NESTED through the schema-derived relation `Invoice.payments`.
      code: 'await tx.invoice.update({ where: { id }, data: { payments: { create: { amount } } } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
      errors: [
        {
          messageId: 'nestedWriteOutsideOwner',
          data: { relation: 'payments', verb: 'create', owner: 'PaymentService', reason: '' },
        },
      ],
    },
    {
      // A model fence also checks a delete's argument for nested writes.
      code: 'await tx.invoice.delete({ where: { id }, data: { payments: { deleteMany: {} } } });',
      filename: OUTSIDE,
      options: opts(PAYMENTS),
      errors: [{ messageId: 'nestedWriteOutsideOwner' }],
    },
    {
      // `relations` adds a name the schema cannot describe.
      code: 'await tx.account.update({ where: { id }, data: { receipts: { create: {} } } });',
      filename: OUTSIDE,
      options: opts({ ...PAYMENTS, relations: ['receipts'] }),
      errors: [{ messageId: 'nestedWriteOutsideOwner' }],
    },
    {
      // Without a schema, the name-shaped floor (model and plural) still bites.
      code: 'await tx.invoice.update({ where: { id }, data: { payments: { create: {} } } });',
      filename: OUTSIDE,
      options: [{ restrictions: [PAYMENTS], schemaPath: '/nonexistent/schema.prisma' }],
      errors: [{ messageId: 'nestedWriteOutsideOwner' }],
    },

    // --- FIELD-scoped ---
    {
      code: 'await tx.invoice.update({ where: { id }, data: { status: "PAID" } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [
        {
          messageId: 'fieldWriteOutsideOwner',
          data: {
            model: 'invoice',
            field: 'status',
            owner: 'InvoiceLifecycleService',
            reason: ' It moves the status by compare-and-swap and writes the ledger entry.',
          },
        },
      ],
    },
    {
      // A quoted key and the alias column are the same write.
      code: 'await tx.invoice.updateMany({ where, data: { "state": "VOID" } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'fieldWriteOutsideOwner' }],
    },
    {
      // upsert: both payload halves are checked.
      code: 'await tx.invoice.upsert({ where: { id }, create: { status: "DRAFT" }, update: { status: "ISSUED" } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'fieldWriteOutsideOwner' }, { messageId: 'fieldWriteOutsideOwner' }],
    },
    {
      // createMany: each element is checked.
      code: 'await tx.invoice.createMany({ data: [{ status: "ISSUED" }, { accountId }, { state: "PAID" }] });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'fieldWriteOutsideOwner' }, { messageId: 'fieldWriteOutsideOwner' }],
    },
    {
      // Opaque payloads: a spread, a variable, a computed key, a spread argument,
      // an argument by reference, an argument with no payload key.
      code: [
        'await tx.invoice.update({ where, data: { ...changes } });',
        'await tx.invoice.update({ where, data });',
        'await tx.invoice.update({ where, data: { [column]: value } });',
        'await tx.invoice.update({ ...args });',
        'await tx.invoice.update(args);',
        'await tx.invoice.update({ where });',
      ].join('\n'),
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [
        {
          messageId: 'opaqueWritePayload',
          data: {
            model: 'invoice',
            method: 'update',
            fields: 'status / state',
            owner: 'InvoiceLifecycleService',
          },
        },
        ...Array.from({ length: 5 }, () => ({ messageId: 'opaqueWritePayload' as const })),
      ],
    },
    {
      // Every delete, zero-arg included: removing the row writes every column.
      code: 'await tx.invoice.delete({ where: { id } }); await tx.invoice.deleteMany();',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'deleteOutsideOwner' }, { messageId: 'deleteOutsideOwner' }],
    },
    {
      // NESTED writes are reported whatever they carry, even with no guarded
      // column: a nested write cannot compare-and-swap.
      code: 'await tx.customer.update({ where: { id }, data: { invoices: { updateMany: { where: {}, data: { dueAt } } } } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'nestedWriteOutsideOwner' }],
    },
    {
      // Nested two levels down is still found.
      code: 'await tx.account.update({ where: { id }, data: { customers: { update: { data: { invoices: { create: {} } } } } } });',
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'nestedWriteOutsideOwner' }],
    },
    // Every relation the schema declares to Invoice, generated from the table so
    // the property under test is "all of them", not the ones someone remembered.
    ...[
      { owner: 'account', relation: 'invoices' },
      { owner: 'account', relation: 'issuedInvoices' },
      { owner: 'customer', relation: 'invoices' },
      { owner: 'invoice', relation: 'supersedes' },
      { owner: 'invoice', relation: 'supersededBy' },
      { owner: 'payment', relation: 'invoice' },
    ].map(({ owner, relation }) => ({
      code: `await tx.${owner}.update({ where: { id }, data: { ${relation}: { update: { data: { note } } } } });`,
      filename: OUTSIDE,
      options: opts(INVOICE_STATUS),
      errors: [{ messageId: 'nestedWriteOutsideOwner' as const }],
    })),

    // --- several fences ---
    {
      // Each fence is independent: the owner of one is outside the other.
      code: 'await tx.payment.create({ data }); await tx.invoice.update({ where, data: { status } });',
      filename: PAYMENT_OWNER,
      options: opts(PAYMENTS, INVOICE_STATUS),
      errors: [{ messageId: 'fieldWriteOutsideOwner' }],
    },
    {
      code: 'await tx.payment.create({ data }); await tx.invoice.update({ where, data: { status } });',
      filename: LIFECYCLE_OWNER,
      options: opts(PAYMENTS, INVOICE_STATUS),
      errors: [{ messageId: 'writeOutsideOwner' }],
    },
  ],
});
