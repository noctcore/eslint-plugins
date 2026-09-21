import type { PrismaClient } from './prisma-client';

export class PrismaService {
  constructor(readonly client: PrismaClient) {}
}
