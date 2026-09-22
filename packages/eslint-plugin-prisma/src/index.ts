import { recommended } from './configs/recommended';
import { rules } from './rules';

/** Flat-config namespace: rule ids are keyed `noctcore-prisma/<rule>`. */
const NAMESPACE = 'noctcore-prisma';
const VERSION = '0.3.2';

const plugin = {
  meta: { name: '@noctcore/eslint-plugin-prisma', version: VERSION },
  rules,
  configs: {} as Record<string, unknown>,
};

// The plugin references itself so `configs.recommended` is a drop-in flat-config
// block: `export default [prisma.configs.recommended]`.
plugin.configs.recommended = {
  plugins: { [NAMESPACE]: plugin },
  rules: recommended,
};

/*
 * The shared Prisma building blocks, exported so a consumer's own tooling (a
 * registry-parity check, a method-surface drift test) reads the same sets and
 * parser the rules do instead of keeping a second copy that drifts.
 */
export {
  PRISMA_CREATE_METHODS,
  PRISMA_DELEGATE_METHODS,
  PRISMA_DELETE_METHODS,
  PRISMA_FILTERED_WRITE_METHODS,
  PRISMA_READ_METHODS,
  PRISMA_SCOPED_READ_METHODS,
  PRISMA_UNIQUE_READ_METHODS,
  PRISMA_UPDATE_METHODS,
  PRISMA_WRITE_METHODS,
} from './utils/prisma-methods';
export {
  DEFAULT_SCHEMA_PATH,
  delegateAccessor,
  loadPrismaSchema,
  parsePrismaSchema,
  relationFieldsForModels,
  resolveSchemaPath,
  tenantBearingAccessors,
} from './utils/prisma-schema';
export type { ParsedPrismaSchema, PrismaRelationField } from './utils/prisma-schema';
export type {
  ModelWriteRestriction,
  RestrictModelWritesOptions,
} from './rules/restrict-model-writes';
export { reconcileTenantRegistry } from './utils/tenant-registry';
export type {
  TenantRegistry,
  TenantRegistryInput,
  TenantRegistryReconciliation,
} from './utils/tenant-registry';
export { rules };
export const configs = plugin.configs;
export default plugin;
