// Stands in for a generated Prisma client: a declaration file, so the walk
// treats it as library code and recognises its delegates by name.
export interface InvoiceDelegate {
  create(args: unknown): Promise<{ id: string }>;
  update(args: unknown): Promise<{ id: string }>;
  findUnique(args: unknown): Promise<{ id: string } | null>;
}
export interface TourProgressDelegate {
  update(args: unknown): Promise<unknown>;
}
export interface AuditLogDelegate {
  create(args: unknown): Promise<unknown>;
}
export interface PrismaClient {
  invoice: InvoiceDelegate;
  tourProgress: TourProgressDelegate;
  auditLog: AuditLogDelegate;
  $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
