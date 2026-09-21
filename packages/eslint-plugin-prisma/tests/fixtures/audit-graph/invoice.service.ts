import type { AuditService } from './audit.service';
import { renameArrow, renameTopLevel } from './helpers';
import type { InvoiceRepository } from './invoice.repository';
import type { IFilerPort } from './ports';
import type { PrismaService } from './prisma.service';

export class InvoiceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly repository: InvoiceRepository,
    private readonly auditService: AuditService,
    private readonly filer: IFilerPort,
  ) {}

  async approve(id: string) {
    await this.repository.rename(id, 'approved');
    await this.auditService.log({ id });
  }

  async approveViaHelper(id: string) {
    await this.repository.rename(id, 'approved');
    await this.recordApproval(id);
  }

  async rename(id: string, name: string) {
    await this.repository.rename(id, name);
  }

  async createInTx() {
    return this.prismaService.client.$transaction(async (tx) => this.repository.create({}, tx));
  }

  async createWithAuditRow() {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.repository.create({}, tx);
      await this.repository.appendAuditRow(tx);
    });
  }

  async read(id: string) {
    return this.repository.find(id);
  }

  async lockOnly() {
    return this.prismaService.client.$transaction((tx) => this.repository.lock(tx));
  }

  async fileIt(id: string) {
    await this.repository.rename(id, 'filed');
    await this.filer.file(id);
  }

  async runCallback(id: string, after: () => Promise<void>) {
    await this.repository.rename(id, 'x');
    await after();
  }

  async finishLater(id: string) {
    await this.repository.rename(id, 'x');
    await Promise.resolve().then(this.auditLater);
  }

  async touchTour() {
    await this.prismaService.client.tourProgress.update({});
  }

  async peek() {
    await this.burnIf();
  }

  async countdown(n: number): Promise<void> {
    if (n > 0) {
      return this.countdown(n - 1);
    }
    await this.repository.rename('a', 'b');
  }

  async viaTopLevel() {
    await renameTopLevel(this.repository);
  }

  async viaArrow() {
    await renameArrow(this.repository);
  }

  async deep1() {
    await this.deep2();
  }

  private async deep2() {
    await this.deep3();
  }

  private async deep3() {
    await this.repository.rename('a', 'b');
  }

  private async recordApproval(id: string) {
    await this.auditService.log({ id });
  }

  private readonly auditLater = async (): Promise<void> => {
    await this.auditService.log({});
  };

  private async burnIf(burn?: boolean) {
    if (burn === true) {
      await this.repository.rename('a', 'b');
    }
  }
}
