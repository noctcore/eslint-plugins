import { ruleTester } from '@noctcore/eslint-test-utils';

import { noAuditWriteInTransactionRule } from '../../src/rules/no-audit-write-in-transaction';

ruleTester.run('no-audit-write-in-transaction', noAuditWriteInTransactionRule, {
  valid: [
    // Audit AFTER the transaction commits is the correct placement.
    {
      code: `
        async function handler() {
          await this.prisma.client.$transaction(async (tx) => {
            await tx.invoice.update({ where: { id }, data });
          });
          await this.auditService.log({ action: 'update' });
        }
      `,
    },
    // No transaction anywhere -> nothing to police.
    {
      code: `
        async function handler() {
          await this.auditService.log({ action: 'update' });
        }
      `,
    },
    // Receiver gate: a non-audit `.log()` inside the tx must NOT fire.
    {
      code: `
        async function handler() {
          await this.prisma.client.$transaction(async (tx) => {
            this.logger.log({ msg: 'inside tx' });
          });
        }
      `,
    },
    // A `.log()` on an audit receiver but outside any tx callback is fine.
    {
      code: `
        async function handler() {
          auditService.log({ action: 'noop' });
        }
      `,
    },
  ],
  invalid: [
    // Canonical: audit log directly inside a `$transaction` callback.
    {
      code: `
        async function handler() {
          await this.prisma.client.$transaction(async (tx) => {
            await tx.invoice.update({ where: { id }, data });
            this.auditService.log({ action: 'update' });
          });
        }
      `,
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
    // Bare-identifier audit receiver inside a `tx.$transaction(...)` callback.
    {
      code: `
        async function handler() {
          await tx.$transaction(async (inner) => {
            auditService.log({ action: 'delete' });
          });
        }
      `,
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
    // Walk-up must not stop at the first function boundary: the audit log is
    // nested one callback deeper (inside a `.forEach`) within the tx callback.
    {
      code: `
        async function handler() {
          await this.prisma.client.$transaction(async (tx) => {
            rows.forEach(() => {
              this.auditService.log({ action: 'each' });
            });
          });
        }
      `,
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
  ],
});

ruleTester.run('no-audit-write-in-transaction (upstream)', noAuditWriteInTransactionRule, {
  valid: [
    {
      // THE LIMIT, pinned: a mutation that is never audited passes. This rule
      // polices where an audit write sits, not whether one exists.
      code: `
        async function handler() {
          await this.prisma.$transaction(async (tx) => {
            await tx.invoice.update({ where: { id }, data });
          });
        }
      `,
    },
    {
      // Top level: the ancestor walk reaches Program, whose parent is null.
      code: 'auditService.log({ action: "boot" });',
    },
    {
      // A top-level transaction with no audit call inside.
      code: 'await prisma.$transaction(async (tx) => { await tx.invoice.create({ data }); });',
    },
    {
      // The array form holds no callback, so there is nothing to be inside.
      code: 'await prisma.$transaction([prisma.invoice.create({ data }), audit.log({ action })]);',
    },
    {
      // A function that merely sits NEXT TO a transaction call is not inside it.
      code: 'await prisma.$transaction(work, () => {}); const f = () => this.audit.log({ action });',
    },
    {
      // auditMethods replaces the default: `.log` no longer counts.
      code: 'await prisma.$transaction(async () => { this.auditService.log({ action }); });',
      options: [{ auditMethods: ['record'] }],
    },
    {
      // auditReceiverPattern replaces the default.
      code: 'await prisma.$transaction(async () => { this.auditService.log({ action }); });',
      options: [{ auditReceiverPattern: '^journal$' }],
    },
  ],
  invalid: [
    {
      // At top level too: the walk finds the callback before it reaches Program.
      code: 'await prisma.$transaction(async (tx) => { await auditService.log({ action }); });',
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
    {
      // A function-expression callback counts like an arrow.
      code: 'await prisma.$transaction(async function (tx) { this.auditLog.log({ action }); });',
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
    {
      code: 'await prisma.$transaction(async () => { this.journal.record({ action }); });',
      options: [{ auditReceiverPattern: '^journal$', auditMethods: ['record', 'log'] }],
      errors: [{ messageId: 'auditInsideTransaction' }],
    },
  ],
});
