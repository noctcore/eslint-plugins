import { BaseRepository } from './base.repository';
import type { PrismaClient } from './prisma-client';

export class InvoiceRepository extends BaseRepository {
  create(data: unknown, tx?: PrismaClient) {
    return (tx ?? this.client).invoice.create({ data });
  }

  rename(id: string, name: string) {
    return this.client.invoice.update({ where: { id }, data: { name } });
  }

  find(id: string) {
    return this.client.invoice.findUnique({ where: { id } });
  }

  appendAuditRow(tx: PrismaClient) {
    return tx.auditLog.create({ data: {} });
  }

  lock(tx: PrismaClient) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;
  }
}
