/**
 * `@noctcore/lint-meta-rules/prisma`: whole-repo Prisma guardrails that keep
 * `@noctcore/eslint-plugin-prisma`'s inputs honest.
 *
 * A separate entry point because these rules read the Prisma method sets and
 * schema parser from `@noctcore/eslint-plugin-prisma`, and the registry parity
 * check resolves an ESLint config (async, so it implements `runAsync`).
 * Importing the main entry never loads either; importing this one needs the
 * optional peer `eslint`.
 */
export {
  createPrismaMethodSurfaceRule,
  parseDelegateSurfaces,
  type DelegateSurface,
  type PrismaMethodSurfaceOptions,
} from './prisma/prisma-method-surface';
export {
  createTenantModelRegistryParityRule,
  parseObjectLiteralKeys,
  type ScopedModelsSource,
  type TenantModelRegistryParityOptions,
  type TenantRegistryEslintOptions,
} from './prisma/tenant-model-registry-parity';
export type { TenantRegistry } from '@noctcore/eslint-plugin-prisma';
