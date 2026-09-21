import type { PrismaClient } from './prisma-client';
import type { PrismaService } from './prisma.service';

// `this.client` matches no receiver option: only the delegate's type says it is Prisma.
export abstract class BaseRepository {
  constructor(protected readonly prismaService: PrismaService) {}

  protected get client(): PrismaClient {
    return this.prismaService.client;
  }
}
